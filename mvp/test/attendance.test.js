import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../test-support/db.js';
import {seal} from '../src/security.js';
import {setting} from '../src/moodle.js';
import {parseReport,sessionDate,simpleForm,attendanceTick,confirmAttendance,setAttendanceEnabled,connectAttendance,webSession,refreshAttendance,attendanceState} from '../src/attendance.js';

const logout='<a href="/login/logout.php?sesskey=csrf">Logout</a>';
const table=(status='',label='Wed 4 Nov 2026 12PM - 2PM')=>`<table><tr><th class="datecol">Date</th><th class="statuscol">Status</th></tr><tr><td class="datecol">${label}</td><td class="desccol">Regular class session</td><td class="statuscol">${status||'<a href="/mod/attendance/attendance.php?sessid=42&amp;sesskey=csrf">Submit attendance</a>'}</td></tr></table>`;
const form=`<form><input type="hidden" name="sessid" value="42"><input type="hidden" name="sesskey" value="csrf"><input type="hidden" name="_qf__mod_attendance_form_studentattendance" value="1"><input type="radio" name="status" id="present" value="8"><label for="present"><span class="statusdesc">Present</span></label><input type="radio" name="status" id="absent" value="9"><label for="absent">Absent</label></form>`;
test('report parser keeps exact row identity, recognised dates and confirmed status, rejects duplicate rows',()=>{
 const r=parseReport(table())[0];assert.equal(r.session,42);assert.equal(r.status,'');assert.equal(r.open,true);assert.equal(sessionDate(r.label),'2026-11-04');assert.equal(sessionDate('04/11/2026'),null);
 assert.equal(parseReport(table('Present'))[0].status,'Present');assert.equal(parseReport(table('?'))[0].open,false);
 assert.equal(parseReport(table('<form><input name="qrpass" type="text"></form>'))[0].password,true);
 assert.throws(()=>parseReport(table().replace('</table>',table().match(/<tr><td[\s\S]*<\/tr>/)[0]+'</table>')),/identical/);
 assert.throws(()=>parseReport('<h1>Sign in</h1>'),/not recognised/);
});
test('only a visible Present choice on the exact session form can be submitted',()=>{
 const p=simpleForm(form,42);assert.equal(p.get('status'),'8');assert.equal(p.get('sesskey'),'csrf');assert.equal(p.get('sessid'),'42');
 assert.equal(simpleForm(form,43),null);assert.equal(simpleForm(form.replace('</form>','<input name="studentpassword"></form>'),42),null);
 assert.equal(simpleForm(form.replace('id="present"','disabled id="present"'),42),null);assert.equal(simpleForm(form.replace('>Present<','>Late<'),42),null);
});
async function fixture(t){
 const {DB,sqlite}=database(),env={DB,AUTH_SECRET:'test-only'},clock=Date.now;
 const now=Date.parse('2026-11-04T04:01:00Z');Date.now=()=>now;
 await setting(DB,'attendance_enabled','1');await setting(DB,'attendance_connection','Connected');await setting(DB,'attendance_cookie',await seal(JSON.stringify([['MoodleSession','cookie']]),env.AUTH_SECRET));await setting(DB,'moodle_token',await seal('token',env.AUTH_SECRET));await setting(DB,'courses',JSON.stringify([{id:1,code:'WIA1007'}]));
 sqlite.prepare('INSERT INTO classes (id,course,kind,starts,ends) VALUES (?,?,?,?,?)').run('class','WIA1007','Lecture','2026-11-04T04:00:00Z','2026-11-04T06:00:00Z');
 sqlite.prepare('INSERT INTO attendance_sessions (id,course,course_id,cmid,name,row_key,day,label,checked) VALUES (?,?,?,?,?,?,?,?,?)').run('row','WIA1007',1,100,'Lecture attendance',parseReport(table())[0].key,'2026-11-04','Wed 4 Nov 2026 12PM - 2PM',new Date(now).toISOString());
 const state={status:'',gets:0,posts:0,password:false,qr:false,expired:false,timeout:false,auto:false,group:2,calls:[],notifications:[]};
 const previous=globalThis.fetch;
 globalThis.fetch=async (url,options={})=>{
  state.calls.push(String(url));
  if(String(url).includes('/webservice/')){
   const fn=options.body.get('wsfunction');assert.notEqual(fn,'tool_mobile_get_content');
   if(fn==='core_course_get_contents')return Response.json([{id:1,name:'OCC 2',modules:[{id:100,modname:'attendance',name:'Lecture attendance'}]}]);
   if(fn==='core_group_get_course_user_groups')return Response.json({groups:[{id:2,idnumber:`2026@${state.group}`}]});
   throw Error('Unexpected API');
  }
  assert.match(options.headers.Cookie,/MoodleSession=cookie/);
  if(state.expired)return new Response('<input name="password" type="password">');
  if(String(url).includes('/view.php'))return new Response(logout+table(state.qr?'<form><input name="qrpass" type="text"></form>':state.status));
  if(String(url).includes('/attendance.php')){
   assert.match(String(url),/sessid=42/);
   if(options.method==='POST'){state.posts++;assert.equal(options.body.get('status'),'8');state.status='Present';}
   else{state.gets++;if(state.auto)state.status='Present';}
   if(state.timeout)throw Error('network error with sensitive details');
   return new Response(logout+(state.password?form.replace('</form>','<input name="studentpassword"></form>'):state.status?table(state.status):form));
  }
  throw Error('Unexpected URL');
 };
 t.after(()=>{globalThis.fetch=previous;Date.now=clock;sqlite.close();});
 const notify=async(id,payload)=>state.notifications.push({id,...payload});
 return {DB,sqlite,env,state,notify,now};
}
test('switch is off by default and cannot enable without a connection; disabling clears confirmations',async t=>{
 const f=await fixture(t);await confirmAttendance(f.env,{id:'row',classId:'class'});await setAttendanceEnabled(f.env,false);
 assert.equal(f.sqlite.prepare('SELECT confirmed_class FROM attendance_sessions').get().confirmed_class,null);
 await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.calls.length,0);
 await f.DB.prepare("DELETE FROM settings WHERE key='attendance_connection'").run();await assert.rejects(()=>setAttendanceEnabled(f.env,true),/Connect attendance/);
});
test('confirmation then one submit verifies report and produces one completion notification',async t=>{
 const f=await fixture(t);await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.posts,0);
 await confirmAttendance(f.env,{id:'row',classId:'class'});await attendanceTick(f.env,f.notify,f.now);await attendanceTick(f.env,f.notify,f.now);
 assert.equal(f.state.posts,1);assert.equal(f.state.notifications.filter(n=>n.id.startsWith('attendance-result:')).length,1);
 assert.equal(f.sqlite.prepare('SELECT recorded,notified FROM attendance_sessions').get().recorded,'Present');
});
test('single-session automatic GET is verified without a second write; existing marks are never overwritten',async t=>{
 const f=await fixture(t);f.state.auto=true;await confirmAttendance(f.env,{id:'row',classId:'class'});await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,1);assert.equal(f.state.posts,0);assert.match(f.state.notifications[0].body,/Present/);
});
test('WIX1003, changed classes and removed groups cannot trigger a submission',async t=>{
 const f=await fixture(t);f.sqlite.exec("UPDATE attendance_sessions SET course='WIX1003'; UPDATE classes SET course='WIX1003'");await assert.rejects(()=>confirmAttendance(f.env,{id:'row',classId:'class'}),/Choose/);
 f.sqlite.exec("UPDATE attendance_sessions SET course='WIA1007'; UPDATE classes SET course='WIA1007'");await confirmAttendance(f.env,{id:'row',classId:'class'});f.sqlite.exec("UPDATE classes SET starts='2026-11-04T05:00:00Z'");await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,0);
 f.sqlite.exec("UPDATE classes SET starts='2026-11-04T04:00:00Z'");await confirmAttendance(f.env,{id:'row',classId:'class'});f.state.group=3;await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,0);assert.match(f.state.notifications.at(-1).body,/group/);
});
test('password and QR sessions stay manual, no password or status is posted',async t=>{
 const f=await fixture(t);f.state.password=true;await confirmAttendance(f.env,{id:'row',classId:'class'});await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.posts,0);assert.match(f.state.notifications[0].title,/needs you/);
 f.sqlite.exec('UPDATE attendance_sessions SET attempted=NULL');f.state.password=false;f.state.qr=true;await confirmAttendance(f.env,{id:'row',classId:'class'});const gets=f.state.gets;await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,gets);assert.equal(f.state.posts,0);
});
test('uncertain write is never repeated and sensitive errors are not exposed',async t=>{
 const f=await fixture(t);f.state.timeout=true;await confirmAttendance(f.env,{id:'row',classId:'class'});await attendanceTick(f.env,f.notify,f.now);await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,1);assert.equal(f.state.posts,0);assert.doesNotMatch(JSON.stringify(f.state.notifications),/sensitive/);await assert.rejects(()=>confirmAttendance(f.env,{id:'row',classId:'class'}),/Choose/);
});
test('expired login fails closed and redirects never forward cookies off SPeCTRUM',async t=>{
 const f=await fixture(t);f.state.expired=true;await confirmAttendance(f.env,{id:'row',classId:'class'});await attendanceTick(f.env,f.notify,f.now);assert.equal(f.state.gets,0);assert.match(f.state.notifications[0].body,/expired/);
 globalThis.fetch=async()=>new Response(null,{status:307,headers:{Location:'https://other.example/steal'}});const web=await webSession(f.env);await assert.rejects(()=>web('/login/index.php',new URLSearchParams({password:'secret'})),/university sign-in/);
});
test('read-only discovery retains unlabelled own activity and never calls marking routes',async t=>{
 const f=await fixture(t);await refreshAttendance(f.env,1,f.notify);assert.equal(f.state.gets,0);assert.equal(f.state.posts,0);const state=await attendanceState(f.env);assert.equal(state.sessions.length,2);assert.ok(!JSON.stringify(state).includes('cookie'));assert.equal(f.state.notifications.length,1);
});
test('attendance sign-in verifies the same student and saves no password',async t=>{
 const f=await fixture(t);let identity=10;
 globalThis.fetch=async(url,options)=>{
  if(url.endsWith('/login/token.php'))return Response.json({token:'new-token'});
  if(url.endsWith('/webservice/rest/server.php'))return Response.json({userid:options.body.get('wstoken')==='new-token'?identity:10});
  if(options.method==='POST')return new Response(logout,{headers:{'Set-Cookie':'MoodleSession=newcookie; Secure; HttpOnly'}});
  return new Response('<input name="logintoken" value="csrf">');
 };
 await connectAttendance(f.env,{username:'student@example.test',password:'never-save-this'});
 assert.equal(await setting(f.DB,'attendance_enabled'),'0');assert.doesNotMatch(JSON.stringify(f.sqlite.prepare('SELECT * FROM settings').all()),/never-save-this|newcookie/);
 identity=11;await setting(f.DB,'attendance_login_after',0);await assert.rejects(()=>connectAttendance(f.env,{username:'other@example.test',password:'secret'}),/same student/);
});
