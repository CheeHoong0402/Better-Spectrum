import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {database} from '../test-support/db.js';
import {seal,unseal} from '../src/security.js';
import {setting} from '../src/moodle.js';
import {pairAttendance,acceptAttendanceHandoff,renewAttendance,refreshAttendance,parseAttendanceQr,connectAttendanceQr} from '../src/attendance.js';
import {parseCallback} from '../scripts/attendance-helper.mjs';
import worker from '../src/worker.js';

const token='a'.repeat(32),privateToken='b'.repeat(32),passport='one-use-passport';
function callback(parts){return 'betterspectrum-attendance://token='+encodeURIComponent(Buffer.from(parts.join(':::')).toString('base64'));}
test('Windows callback validates the launch passport, exact scheme and private token',()=>{
 const siteid=createHash('md5').update('https://spectrum.um.edu.my'+passport).digest('hex');
 assert.deepEqual(parseCallback(callback([siteid,token,privateToken]),passport),{token,privateToken});
 assert.throws(()=>parseCallback(callback([siteid,token,privateToken]),'wrong'),/does not match/);
 assert.throws(()=>parseCallback(callback([siteid,token]),passport),/private token/);
 assert.throws(()=>parseCallback('moodlemobile://token=anything',passport),/Unexpected/);
 assert.throws(()=>parseCallback(callback([siteid,token,privateToken,'extra']),passport),/private token/);
});
async function fixture(t){
 const {DB,sqlite}=database(),env={DB,AUTH_SECRET:'test-only',APP_PASSWORD:'test-only'};
 await setting(DB,'moodle_token',await seal('existing-token',env.AUTH_SECRET));await setting(DB,'courses',JSON.stringify([{id:1,code:'WIA1007'}]));
 const previous=globalThis.fetch,requests=[];let userid=42,deny=false;
 globalThis.fetch=async(url,options={})=>{
  requests.push({url:String(url),fn:options.body?.get?.('wsfunction'),method:options.method});
  if(String(url).includes('/webservice/')){
   const p=options.body;
   switch(p.get('wsfunction')){
    case 'core_webservice_get_site_info':return Response.json({userid:p.get('wstoken')==='existing-token'?42:userid});
    case 'tool_mobile_get_tokens_for_qr_login':assert.match(options.headers['User-Agent'],/BetterSpectrum.*MoodleMobile/);assert.equal(p.get('userid'),'42');return Response.json({token,privatetoken:privateToken,warnings:[]});
    case 'tool_mobile_get_autologin_key':assert.equal(p.get('privatetoken'),privateToken);assert.match(options.headers['User-Agent'],/BetterSpectrum.*MoodleMobile/);return Response.json(deny?{exception:'moodle_exception'}:{key:'once-key',autologinurl:'https://spectrum.um.edu.my/admin/tool/mobile/autologin.php'});
    case 'core_course_get_contents':return Response.json([{id:1,name:'General',modules:[{id:100,modname:'attendance',name:'Lecture attendance'}]}]);
    case 'core_group_get_course_user_groups':return Response.json({groups:[{id:2,idnumber:'2026@2'}]});
   }
  }
  if(String(url).includes('/autologin.php'))return new Response(null,{status:303,headers:{'Set-Cookie':'MoodleSession=sessionsecret; Secure; HttpOnly',Location:'/my/'}});
  assert.match(options.headers.Cookie,/MoodleSession=sessionsecret/);
  return new Response('<a href="/login/logout.php?sesskey=secret">Logout</a><table><tr><td class="datecol">Wed 4 Nov 2026 12PM - 2PM</td><td class="desccol">Lecture</td><td class="statuscol">?</td></tr></table>');
 };
 t.after(()=>{globalThis.fetch=previous;sqlite.close();});
 return {DB,sqlite,env,requests,setUser:v=>userid=v,deny:()=>deny=true};
}
test('pairing is one-use, checks the account, verifies a read-only report, and leaves marking off',async t=>{
 const f=await fixture(t),pair=await pairAttendance(f.env);const data={code:pair.code,token,privateToken};
 const response=await worker.fetch(new Request('https://planner.test/api/attendance-handoff',{method:'POST',headers:{Origin:'https://planner.test','Content-Type':'application/json'},body:JSON.stringify(data)}),f.env);
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.enabled,false);assert.equal(result.verified.rows,1);
 const saved=JSON.parse(await unseal(await setting(f.DB,'attendance_mobile'),f.env.AUTH_SECRET));assert.equal(saved.privateToken,privateToken);
 assert.equal(await setting(f.DB,'attendance_enabled'),'0');assert.equal(await setting(f.DB,'attendance_connection'),'Connected');
 assert.ok(!f.requests.some(r=>/\/attendance\.php/.test(r.url)));
 assert.ok(!JSON.stringify(f.sqlite.prepare('SELECT * FROM settings').all()).includes(privateToken));
 await assert.rejects(()=>acceptAttendanceHandoff(f.env,data),/already used/);
});
test('wrong account, expired or replaced codes cannot establish a connection',async t=>{
 const f=await fixture(t),old=await pairAttendance(f.env),pair=await pairAttendance(f.env);
 await assert.rejects(()=>acceptAttendanceHandoff(f.env,{code:old.code,token,privateToken}),/expired/);
 f.setUser(43);await assert.rejects(()=>acceptAttendanceHandoff(f.env,{code:pair.code,token,privateToken}),/same student/);
 assert.equal(await setting(f.DB,'attendance_mobile'),undefined);assert.equal(f.requests.filter(r=>r.fn==='tool_mobile_get_autologin_key').length,0);
 const current=await pairAttendance(f.env),raw=JSON.parse(await setting(f.DB,'attendance_pair'));raw.expires=0;await setting(f.DB,'attendance_pair',JSON.stringify(raw));
 await assert.rejects(()=>acceptAttendanceHandoff(f.env,{code:current.code,token,privateToken}),/expired/);
});
test('denied auto-login is bounded, and pairing endpoints retain normal authentication and origin checks',async t=>{
 const f=await fixture(t);f.deny();await assert.rejects(()=>renewAttendance(f.env,{token,privateToken,userid:42}),/did not allow/);
 await assert.rejects(()=>renewAttendance(f.env,{token,privateToken,userid:42}),/six minutes/);
 assert.equal(f.requests.filter(r=>r.fn==='tool_mobile_get_autologin_key').length,1);
 assert.equal((await worker.fetch(new Request('https://planner.test/api/attendance-pair',{method:'POST',headers:{Origin:'https://planner.test'},body:'{}'}),f.env)).status,401);
 assert.equal((await worker.fetch(new Request('https://planner.test/api/attendance-handoff',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'}),f.env)).status,403);
});


test('a cancelled handoff cannot save a connection after verification has started',async t=>{
 const f=await fixture(t),pair=await pairAttendance(f.env),previous=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{if(String(url).includes('/mod/attendance/view.php'))await f.DB.prepare("DELETE FROM settings WHERE key='attendance_pair'").run();return previous(url,options);};
 await assert.rejects(()=>acceptAttendanceHandoff(f.env,{code:pair.code,token,privateToken}),/cancelled or replaced/);
 assert.equal(await setting(f.DB,'attendance_mobile'),undefined);assert.equal(await setting(f.DB,'attendance_cookie'),undefined);
});

test('expired report sessions renew through the saved mobile connection without visiting marking pages',async t=>{
 const f=await fixture(t),pair=await pairAttendance(f.env);await acceptAttendanceHandoff(f.env,{code:pair.code,token,privateToken});
 await setting(f.DB,'attendance_renew_after',0);await setting(f.DB,'attendance_cookie',await seal(JSON.stringify([['MoodleSession','expired']]),f.env.AUTH_SECRET));
 const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>options?.headers?.Cookie?.includes('expired')?new Response(null,{status:303,headers:{Location:'https://login.microsoftonline.com/university'}}):previous(url,options);
 await refreshAttendance(f.env,1);assert.equal(f.requests.filter(r=>r.fn==='tool_mobile_get_autologin_key').length,2);assert.ok(!f.requests.some(r=>/\/attendance\.php/.test(r.url)));
});


test('QR login accepts only the pinned SPeCTRUM destination and exact user identity',()=>{
 const key='q'.repeat(32),url=`moodlemobile://https://spectrum.um.edu.my?qrlogin=${key}&userid=42`;
 assert.deepEqual(parseAttendanceQr(url),{key,userid:42});
 for(const value of [url.replace('spectrum.um.edu.my','evil.example'),url+'&userid=43',url.replace('https://','http://'),url.replace('userid=42','userid=-1'),'not a QR link'])assert.throws(()=>parseAttendanceQr(value));
});

test('QR connection exchanges the one-time key and verifies a read-only cloud report',async t=>{
 const f=await fixture(t),url=`moodlemobile://https://spectrum.um.edu.my?qrlogin=${'q'.repeat(32)}&userid=42`;
 const r=await connectAttendanceQr(f.env,url);assert.equal(r.ok,true);assert.equal(r.enabled,false);assert.equal(r.verified.course,'WIA1007');
 assert.equal(f.requests.filter(r=>r.fn==='tool_mobile_get_tokens_for_qr_login').length,1);
 assert.ok(!f.requests.some(r=>/\/attendance\.php/.test(r.url)));
 await assert.rejects(()=>connectAttendanceQr(f.env,url),/one minute/);
});

test('QR for another account and expired QR keys never establish a connection',async t=>{
 const f=await fixture(t),url=`moodlemobile://https://spectrum.um.edu.my?qrlogin=${'q'.repeat(32)}&userid=43`;
 await assert.rejects(()=>connectAttendanceQr(f.env,url),/same student/);assert.equal(f.requests.filter(r=>r.fn==='tool_mobile_get_tokens_for_qr_login').length,0);
 const previous=globalThis.fetch;globalThis.fetch=async(url,options)=>options.body?.get?.('wsfunction')==='tool_mobile_get_tokens_for_qr_login'?Response.json({exception:'moodle_exception',errorcode:'invalidkey'}):previous(url,options);
 await assert.rejects(()=>connectAttendanceQr(f.env,url.replace('userid=43','userid=42')),/fresh image/);
 assert.equal(await setting(f.DB,'attendance_mobile'),undefined);
});
