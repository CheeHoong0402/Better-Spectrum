import {call,setting,currentCourses} from './moodle.js';
import {seal,unseal,digest} from './security.js';
import {courseScope,groupNumbers} from './course-scope.js';

const origin='https://spectrum.um.edu.my';
export class AttendanceError extends Error {constructor(message,code){super(message);this.code=code;}}
const decode=s=>String(s||'').replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi,x=>({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&nbsp;':' '}[x]??String.fromCodePoint(Math.min(0x10ffff,x[2].toLowerCase()==='x'?parseInt(x.slice(3),16):parseInt(x.slice(2),10)))));
const text=s=>decode(String(s||'').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
function attrs(tag){return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1],decode(m[2]??m[3])]));}
function inputs(html){return [...html.matchAll(/<input\b[^>]*>/gi)].map(m=>({...attrs(m[0]),disabled:/\bdisabled(?:\s|=|>)/i.test(m[0])}));}
function safeUrl(path){const u=new URL(path,origin);if(u.origin!==origin||u.username||u.password)throw new AttendanceError('SPeCTRUM requires Microsoft university sign-in. Automatic attendance cannot connect through this form. Open SPeCTRUM and mark manually.','university_sign_in');return u;}

// Only this normal web session visits marking pages; the mobile activity view can mark unrelated open sessions.
export async function webSession(env,initial=''){
 const saved=initial||await setting(env.DB,'attendance_cookie');
 const jar=new Map(saved?JSON.parse(await unseal(saved,env.AUTH_SECRET)):[]);
 let stored=JSON.stringify([...jar]);
 const web=async function web(path,body){
  let url=safeUrl(path),method=body?'POST':'GET';
  for(let n=0;n<6;n++){
   let r;try{r=await fetch(url.href,{method,body:method==='POST'?body:undefined,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded',Origin:origin}:{})}});}catch{throw new AttendanceError('SPeCTRUM attendance could not be reached. Try again, or open SPeCTRUM to mark manually.');}
   for(const value of r.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');if(i>0){const k=pair.slice(0,i),v=pair.slice(i+1);if(v)jar.set(k,v);else jar.delete(k);}}
   if(r.status>=300&&r.status<400){url=safeUrl(new URL(r.headers.get('location'),url));if(r.status!==307&&r.status!==308){method='GET';body=undefined;}continue;}
   if(!r.ok)throw new AttendanceError('SPeCTRUM attendance is temporarily unavailable.');
   const html=await r.text();if(html.length>2000000)throw new AttendanceError('SPeCTRUM attendance page was too large to check safely.');
   const value=JSON.stringify([...jar]),cookie=await seal(value,env.AUTH_SECRET);
   if(!initial&&value!==stored){await setting(env.DB,'attendance_cookie',cookie);stored=value;}
   return {html,url:url.href,cookie};
  }
  throw new AttendanceError('SPeCTRUM sign-in did not complete.');
 };
 web.adopt=async cookie=>{jar.clear();for(const [k,v] of JSON.parse(await unseal(cookie,env.AUTH_SECRET)))jar.set(k,v);stored=JSON.stringify([...jar]);};
 web.cookie=()=>seal(JSON.stringify([...jar]),env.AUTH_SECRET);
 return web;
}
function loggedIn(page){return !/name=["'](?:password|logintoken)["']/i.test(page.html)&&/\/login\/logout\.php\?[^"']*sesskey=/.test(page.html);}
export async function pairAttendance(env){
 if(!await setting(env.DB,'moodle_token'))throw new AttendanceError('Connect course sync first.');
 const code=crypto.randomUUID()+crypto.randomUUID();
 await setting(env.DB,'attendance_pair',JSON.stringify({hash:await digest(code),expires:Date.now()+600000}));
 return {code,expires:new Date(Date.now()+600000).toISOString()};
}
export function parseAttendanceQr(value){
 if(typeof value!=='string'||value.length>1200)throw new AttendanceError('Choose your SPeCTRUM mobile-app sign-in QR code.');
 let url;try{url=new URL(value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/(?=https:\/\/)/i,''));}catch{throw new AttendanceError('This QR code is not a mobile-app sign-in link.');}
 const key=url.searchParams.get('qrlogin'),userid=Number(url.searchParams.get('userid'));
 if(url.origin!==origin||url.pathname!=='/'||url.username||url.password||url.hash||!key||!/^[a-zA-Z0-9_-]{16,128}$/.test(key)||!Number.isSafeInteger(userid)||userid<1||url.searchParams.getAll('qrlogin').length!==1||url.searchParams.getAll('userid').length!==1)throw new AttendanceError('Use the mobile-app QR code from your own SPeCTRUM profile.');
 return {key,userid};
}
export async function connectAttendanceQr(env,value){
 const qr=parseAttendanceQr(value),encrypted=await setting(env.DB,'moodle_token');if(!encrypted)throw new AttendanceError('Connect course sync first.');
 const token=await unseal(encrypted,env.AUTH_SECRET),info=await call(token,'core_webservice_get_site_info');
 if(info.userid!==qr.userid)throw new AttendanceError('Use the QR code for the same student account as course sync.');
 if(Number(await setting(env.DB,'attendance_qr_after')||0)>Date.now())throw new AttendanceError('Wait one minute before trying a new QR code.');
 await setting(env.DB,'attendance_qr_after',Date.now()+60000);
 const pair=await pairAttendance(env);let credentials;
 try{credentials=await call(token,'tool_mobile_get_tokens_for_qr_login',{qrloginkey:qr.key,userid:qr.userid},{'User-Agent':'BetterSpectrum/1.0 (MoodleMobile compatible client)'});}
 catch{throw new AttendanceError('SPeCTRUM did not accept this QR code. Refresh your SPeCTRUM profile, open View QR code, and try a fresh image.');}
 if(!credentials.token||!credentials.privatetoken||credentials.warnings?.length)throw new AttendanceError('SPeCTRUM did not return a complete mobile connection. Generate a fresh QR code and try again.');
 return acceptAttendanceHandoff(env,{code:pair.code,token:credentials.token,privateToken:credentials.privatetoken});
}
export async function renewAttendance(env,credentials,persist=true){
 const saved=await setting(env.DB,'attendance_mobile');
 credentials||=saved?JSON.parse(await unseal(saved,env.AUTH_SECRET)):null;
 if(!credentials)throw new AttendanceError('Reconnect with the Windows sign-in helper.');
 if(Number(await setting(env.DB,'attendance_renew_after')||0)>Date.now())throw new AttendanceError('SPeCTRUM limits reconnects. Wait six minutes before trying again.');
 await setting(env.DB,'attendance_renew_after',Date.now()+360000);
 let result;
 try{
  const r=await fetch(origin+'/webservice/rest/server.php',{method:'POST',headers:{'User-Agent':'BetterSpectrum/1.0 (MoodleMobile compatible client)'},body:new URLSearchParams({wstoken:credentials.token,wsfunction:'tool_mobile_get_autologin_key',moodlewsrestformat:'json',privatetoken:credentials.privateToken}),signal:AbortSignal.timeout(20000)});
  result=await r.json();if(!r.ok||result.exception||!result.key)throw new Error();
 }catch{throw new AttendanceError('SPeCTRUM did not allow mobile auto-login. Reconnect with the helper after six minutes, or mark manually.');}
 const url=safeUrl(result.autologinurl);if(url.pathname!=='/admin/tool/mobile/autologin.php'||!/^[a-zA-Z0-9_-]+$/.test(result.key))throw new AttendanceError('SPeCTRUM returned an unexpected auto-login response.');
 url.search=new URLSearchParams({userid:String(credentials.userid),key:result.key,urltogo:origin+'/my/'}).toString();
 const web=await webSession(env,await seal('[]',env.AUTH_SECRET)),page=await web(url.href);
 if(!loggedIn(page))throw new AttendanceError('Mobile auto-login did not establish a signed-in session.');
 if(persist)await setting(env.DB,'attendance_cookie',page.cookie);return web;
}
export async function acceptAttendanceHandoff(env,data){
 if(typeof data.code!=='string'||data.code.length!==72||typeof data.token!=='string'||!/^[a-zA-Z0-9]{16,128}$/.test(data.token)||typeof data.privateToken!=='string'||!/^[a-zA-Z0-9]{16,128}$/.test(data.privateToken))throw new AttendanceError('Invalid attendance handoff. Generate a new pairing code.');
 const raw=await setting(env.DB,'attendance_pair'),pair=JSON.parse(raw||'null');
 if(!pair||pair.claimed||pair.expires<Date.now()||pair.hash!==await digest(data.code))throw new AttendanceError('Pairing code expired or was already used. Generate a new code in Settings.');
 const claim=JSON.stringify({...pair,claimed:true});
 const claimed=await env.DB.prepare("UPDATE settings SET value=? WHERE key='attendance_pair' AND value=? RETURNING key").bind(claim,raw).first();if(!claimed)throw new AttendanceError('Pairing code was already used.');
 const current=await setting(env.DB,'moodle_token');if(!current)throw new AttendanceError('Connect course sync first.');
 const [existing,provided]=await Promise.all([call(await unseal(current,env.AUTH_SECRET),'core_webservice_get_site_info'),call(data.token,'core_webservice_get_site_info')]);
 if(!Number.isSafeInteger(provided.userid)||existing.userid!==provided.userid)throw new AttendanceError('Sign in using the same student account as course sync.');
 await setAttendanceEnabled(env,false);
 const credentials={token:data.token,privateToken:data.privateToken,userid:provided.userid};
 const web=await renewAttendance(env,credentials,false),courses=(await currentCourses(env.DB)).filter(c=>c.id!=null&&c.code!=='WIX1003');
 let verified=null;
 for(const course of courses){const {items}=await modules(env,course);if(items.length){const page=await web(`/mod/attendance/view.php?id=${items[0].id}&view=5&lang=en`);if(!loggedIn(page))throw new AttendanceError('Attendance report sign-in could not be verified.');verified={course:course.code,rows:parseReport(page.html).length};break;}}
 if(!verified)throw new AttendanceError('No eligible attendance report was found to verify this connection.');
 if(await setting(env.DB,'attendance_pair')!==claim)throw new AttendanceError('Pairing was cancelled or replaced. Generate a new code.');
 const values=[['attendance_mobile',await seal(JSON.stringify(credentials),env.AUTH_SECRET)],['attendance_cookie',await web.cookie()],['attendance_connection','Connected'],['attendance_error','']];
 await env.DB.batch([...values.map(([k,v])=>env.DB.prepare("INSERT OR REPLACE INTO settings SELECT ?,? WHERE EXISTS (SELECT 1 FROM settings WHERE key='attendance_pair' AND value=?)").bind(k,v,claim)),env.DB.prepare("DELETE FROM settings WHERE key='attendance_pair' AND value=?").bind(claim)]);
 return {ok:true,verified,enabled:false,message:'Cloud attendance report verified. Auto-marking remains off. You can enable it in Settings to mark sessions matching your saved class times.'};
}
export async function checkAttendanceSupport(env){
 if(await setting(env.DB,'attendance_mobile')&&await setting(env.DB,'attendance_connection')==='Connected')return {supported:true};
 try{
  const web=await webSession(env,await seal('[]',env.AUTH_SECRET));
  const login=await web('/login/index.php');
  if(!inputs(login.html).some(i=>i.name==='logintoken'&&i.value))throw new AttendanceError('SPeCTRUM requires interactive sign-in. Open SPeCTRUM and mark attendance manually.','university_sign_in');
  await setting(env.DB,'attendance_connection','Direct sign-in available');return {supported:true};
 }catch(e){
  if(e.code!=='university_sign_in')throw e;
  await setAttendanceEnabled(env,false);
  await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_connection','University sign-in required'),env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_error',e.message),env.DB.prepare("DELETE FROM settings WHERE key='attendance_cookie'")]);
  return {supported:false,message:e.message};
 }
}
export async function connectAttendance(env,{username,password}){
 if(typeof username!=='string'||!username.trim()||username.length>200||typeof password!=='string'||!password||password.length>500)throw new AttendanceError('Enter your Siswa email and SPeCTRUM password.');
 const encrypted=await setting(env.DB,'moodle_token');if(!encrypted)throw new AttendanceError('Connect SPeCTRUM course sync first.');
 const support=await checkAttendanceSupport(env);if(!support.supported)throw new AttendanceError(support.message);
 const throttle=Number(await setting(env.DB,'attendance_login_after')||0);if(throttle>Date.now())throw new AttendanceError('Wait a minute before trying attendance sign-in again.');
 await setting(env.DB,'attendance_login_after',Date.now()+60000);
 // Verify both connections identify the same student before retaining any browser session.
 let r,credentials;try{r=await fetch(origin+'/login/token.php',{method:'POST',redirect:'error',body:new URLSearchParams({username:username.trim(),password,service:'moodle_mobile_app'}),signal:AbortSignal.timeout(20000)});credentials=await r.json();}catch{throw new AttendanceError('SPeCTRUM did not return a usable sign-in response. Open SPeCTRUM and mark attendance manually.');}
 if(!r.ok||!credentials.token)throw new AttendanceError('SPeCTRUM could not sign in. Check your details, or use SPeCTRUM directly if university sign-in is required.');
 const [current,provided]=await Promise.all([call(await unseal(encrypted,env.AUTH_SECRET),'core_webservice_get_site_info'),call(credentials.token,'core_webservice_get_site_info')]);
 if(current.userid!==provided.userid)throw new AttendanceError('Use the same student account as your connected courses.');
 const web=await webSession(env,await seal('[]',env.AUTH_SECRET));
 const login=await web('/login/index.php');const token=inputs(login.html).find(i=>i.name==='logintoken')?.value;
 if(!token)throw new AttendanceError('SPeCTRUM requires an interactive sign-in. Use attendance manually for now.');
 const page=await web('/login/index.php',new URLSearchParams({username:username.trim(),password,logintoken:token}));
 if(!loggedIn(page))throw new AttendanceError('Attendance sign-in needs an extra step. Open SPeCTRUM and mark manually.');
 await setAttendanceEnabled(env,false);
 await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_cookie',page.cookie),env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_connection','Connected')]);
}

export function parseReport(html){
 const tables=[...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(m=>m[0]).filter(t=>/\bdatecol\b/.test(t)&&/\bstatuscol\b/.test(t));
 if(tables.length!==1)throw new AttendanceError('The attendance report format is not recognised. Open SPeCTRUM to check it.');
 const rows=[];
 for(const match of tables[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const cells=[...match[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)];
  const cell=cls=>cells.find(c=>(attrs(c[1]).class||'').split(/\s+/).includes(cls))?.[2];
  const date=cell('datecol'),description=cell('desccol'),status=cell('statuscol');if(!date||status===undefined)continue;
  const label=text(date),details=text(description);
  const links=[...status.matchAll(/<a\b[^>]*>/gi)].map(m=>attrs(m[0]).href).filter(Boolean).map(h=>safeUrl(h)).filter(u=>u.pathname==='/mod/attendance/attendance.php');
  const ids=[...new Set(links.map(u=>u.searchParams.get('sessid')).filter(i=>/^\d+$/.test(i||'')))];
  const password=/name=["'](?:qrpass|studentpassword)["']/.test(status);
  const recorded=text(status.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi,''));
  rows.push({key:label+'|'+details,label,description:details,session:ids.length===1?Number(ids[0]):null,password,status:password?'':recorded==='?'?'':recorded,open:ids.length===1&&!password});
 }
 if(new Set(rows.map(r=>r.key)).size!==rows.length)throw new AttendanceError('Some attendance sessions look identical. Please select the session in SPeCTRUM.');
 return rows;
}

export function sessionDate(label){
 // shortcut: English Moodle report dates only; reject unfamiliar formats until a matching parser is verified.
 const m=label.match(/\b(\d{1,2})[ .\/-]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[ .\/-]+(\d{4})\b/i);
 if(!m)return null;
 const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase())+1;
 return `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
export function sessionWindow(label){
 const day=sessionDate(label),match=label.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*$/i);
 const stamp=Date.parse(day+'T00:00:00Z');
 if(!day||!match||!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==day)return null;
 const hours=[Number(match[1]),Number(match[4])],minutes=[Number(match[2]||0),Number(match[5]||0)];
 if(hours.some(h=>h<1||h>12)||minutes.some(m=>m>59))return null;
 const times=hours.map((h,i)=>Date.parse(`${day}T${String(h%12+(/pm/i.test(match[i?6:3])?12:0)).padStart(2,'0')}:${String(minutes[i]).padStart(2,'0')}:00+08:00`));
 return times[1]>times[0]?times:null;
}
export function simpleForm(html,session){
 const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].filter(m=>inputs(m[1]).some(i=>i.name==='sessid'&&i.value===String(session)));
 if(forms.length!==1)return null;
 const fields=inputs(forms[0][1]);if(fields.some(i=>['studentpassword','qrpass'].includes(i.name)))return null;
 const labels=[...forms[0][1].matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)];
 const present=fields.filter(i=>i.name==='status'&&i.type==='radio'&&!i.disabled&&i.id).filter(i=>labels.some(label=>{
  const target=attrs(label[1]).for;
  return (target?target===i.id:inputs(label[2]).some(input=>input.id===i.id&&input.name==='status'))&&/^(Present|Hadir)$/i.test(text(label[2]));
 }));
 if(present.length!==1||!/^\d+$/.test(present[0].value)||!fields.some(i=>i.name==='sesskey'&&i.value))return null;
 const body=new URLSearchParams(fields.filter(i=>i.type==='hidden'&&i.name&&i.value!==undefined).map(i=>[i.name,i.value]));body.set('status',present[0].value);body.set('submitbutton','Save changes');return body;
}

async function modules(env,course){
 const token=await unseal(await setting(env.DB,'moodle_token'),env.AUTH_SECRET);
 const [sections,membership]=await Promise.all([call(token,'core_course_get_contents',{courseid:course.id}),call(token,'core_group_get_course_user_groups',{courseid:course.id})]);
 if(!Array.isArray(membership.groups)||membership.warnings?.length)throw new AttendanceError('Group membership could not be checked.');
 const numbers=membership.groups.flatMap(g=>/@(\d+)$/.test(g.idnumber||'')?[Number(g.idnumber.match(/@(\d+)$/)[1])]:groupNumbers(g.name,true));
 if(!numbers.length)throw new AttendanceError('Your course group could not be verified.');
 return {items:courseScope(sections,numbers,JSON.parse(await setting(env.DB,`course_scope:${course.id}`)||'{}')).modules.filter(m=>m.modname==='attendance'),numbers};
}
async function report(web,cmid,env){
 const path=`/mod/attendance/view.php?id=${cmid}&view=5&lang=en`;let page;
 try{page=await web(path);if(!loggedIn(page))throw new AttendanceError('Attendance sign-in expired. Reconnect in Settings.');}
 catch(e){if(!env||!await setting(env.DB,'attendance_mobile'))throw e;const fresh=await renewAttendance(env);await web.adopt(await setting(env.DB,'attendance_cookie'));page=await fresh(path);if(!loggedIn(page))throw new AttendanceError('Attendance sign-in expired. Reconnect with the helper.');}
 return parseReport(page.html);
}
export async function attendanceState(env){
 const config=Object.fromEntries((await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('attendance_enabled','attendance_connection','attendance_checked','attendance_error')").all()).results.map(r=>[r.key,r.value]));
 return {enabled:config.attendance_enabled==='1',connected:config.attendance_connection==='Connected',connection:config.attendance_connection||'Not connected',lastCheck:config.attendance_checked||null,error:config.attendance_error||'',sessions:(await env.DB.prepare("SELECT * FROM attendance_sessions WHERE day>=? ORDER BY day,label LIMIT 80").bind(new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10)).all()).results};
}
export async function refreshAttendance(env,courseid,notify){
 const course=(await currentCourses(env.DB)).find(c=>c.id===Number(courseid));if(!course)throw new AttendanceError('Choose a connected course.');
 if(course.code==='WIX1003')return;
 if(!await setting(env.DB,'attendance_cookie'))throw new AttendanceError('Connect attendance in Settings first.');
 const {items:available,numbers}=await modules(env,course),web=await webSession(env),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),until=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
 const writes=[];
 for(const m of available){
  const rows=await report(web,m.id,env);
  for(const row of rows){const date=sessionDate(row.label),groups=groupNumbers(row.description,true);if(!date||date<day||date>until||groups.length&&!groups.some(n=>numbers.includes(n)))continue;
   const id=await digest(`${m.id}:${row.key}`);
   writes.push(env.DB.prepare("INSERT INTO attendance_sessions (id,course,course_id,cmid,name,row_key,day,label,session_id,recorded,manual,checked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=CASE WHEN attendance_sessions.attempted IS NOT NULL THEN attendance_sessions.session_id ELSE excluded.session_id END,recorded=excluded.recorded,manual=excluded.manual,checked=excluded.checked,message=CASE WHEN excluded.recorded<>'' THEN 'Verified in SPeCTRUM' ELSE attendance_sessions.message END").bind(id,course.code,course.id,m.id,text(m.name),row.key,date,row.label,row.session,row.status,row.password?1:0,new Date().toISOString()));
   if(notify&&row.open&&!row.status)await notify(`attendance-open:${id}`,{title:`${course.code} · attendance is open`,body:`${row.label}. Auto-marking follows your saved class times when enabled.`,url:'/#settings/attendance'});
  }
 }
 // Removed or hidden activities must never retain permission to mark.
 writes.push(env.DB.prepare('DELETE FROM attendance_sessions WHERE attempted IS NULL AND course_id=?'+(available.length?' AND cmid NOT IN ('+available.map(()=>'?').join(',')+')':'')).bind(course.id,...available.map(m=>m.id)));
 writes.push(env.DB.prepare('DELETE FROM attendance_sessions WHERE day<? AND attempted IS NULL').bind(day));
 if(writes.length)await env.DB.batch(writes);
 if(notify){
  const completed=(await env.DB.prepare("SELECT * FROM attendance_sessions WHERE course_id=? AND recorded<>'' AND attempted IS NOT NULL AND notified=0").bind(course.id).all()).results;
  for(const row of completed)await recordedAttendance(env,notify,row,row.recorded);
 }
 await setting(env.DB,'attendance_checked',new Date().toISOString());await setting(env.DB,'attendance_error','');
}
async function recordedAttendance(env,notify,row,status){
 await env.DB.prepare('UPDATE attendance_sessions SET recorded=?,message=? WHERE id=?').bind(status,'Verified in SPeCTRUM',row.id).run();
 await notify(`attendance-result:${row.id}`,{title:`${row.course} · attendance confirmed`,body:`${row.label} · ${status}. Verified in SPeCTRUM.`,url:'/#settings/attendance'});
 await env.DB.prepare('UPDATE attendance_sessions SET notified=1 WHERE id=?').bind(row.id).run();
}
export async function setAttendanceEnabled(env,enabled){
 if(typeof enabled!=='boolean')throw new AttendanceError('Choose on or off.');
 if(enabled&&await setting(env.DB,'attendance_connection')!=='Connected')throw new AttendanceError('Connect attendance before enabling auto-marking.');
 await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_enabled',enabled?'1':'0'),env.DB.prepare("UPDATE attendance_sessions SET confirmed_class=NULL,message='Automatic match cleared' WHERE attempted IS NULL AND confirmed_class IS NOT NULL")]);
}
export async function confirmAttendance(env,{id,classId}){
 if(await setting(env.DB,'attendance_enabled')!=='1')throw new AttendanceError('Enable auto-marking in Settings first.');
 const row=await env.DB.prepare('SELECT * FROM attendance_sessions WHERE id=?').bind(id).first();
 const c=await env.DB.prepare('SELECT * FROM classes WHERE id=?').bind(classId).first();
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(!row||!c||row.course==='WIX1003'||row.course!==c.course||row.day!==today||new Date(Date.parse(c.starts)+8*3600000).toISOString().slice(0,10)!==row.day||Date.parse(c.ends)<=Date.now()||row.manual||row.recorded||row.attempted)throw new AttendanceError('Choose an unmarked session for a class you are attending today.');
 await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=?,class_starts=?,class_ends=?,message=? WHERE id=?').bind(c.id,c.starts,c.ends,'Confirmed by you · waiting for an eligible session',id).run();
}

async function scheduleAttendance(env,now){
 const stamp=new Date(now).toISOString(),day=new Date(now+8*3600000).toISOString().slice(0,10);
 const candidates=(await env.DB.prepare("SELECT a.id,a.label,c.id AS class_id,c.starts,c.ends FROM attendance_sessions a JOIN classes c ON c.course=a.course WHERE a.confirmed_class IS NULL AND a.attempted IS NULL AND a.recorded='' AND a.manual=0 AND a.course<>'WIX1003' AND a.day=? AND a.message<>'Skipped by you' AND julianday(c.starts)<=julianday(?) AND julianday(c.ends)>julianday(?)").bind(day,stamp,stamp).all()).results;
 const writes=[];
 for(const id of new Set(candidates.map(row=>row.id))){
  const matches=candidates.filter(row=>{const range=sessionWindow(row.label);return row.id===id&&range&&range[0]===Date.parse(row.starts)&&range[1]===Date.parse(row.ends);});
  if(matches.length!==1)continue;
  const row=matches[0];writes.push(env.DB.prepare("UPDATE attendance_sessions SET confirmed_class=?,class_starts=?,class_ends=?,message='Scheduled automatically from your timetable' WHERE id=? AND confirmed_class IS NULL AND attempted IS NULL AND message<>'Skipped by you'").bind(row.class_id,row.starts,row.ends,id));
 }
 if(writes.length)await env.DB.batch(writes);
}
export async function attendanceTick(env,notify,now=Date.now()){
 if(await setting(env.DB,'attendance_enabled')!=='1')return;
 if(!await setting(env.DB,'attendance_cookie'))return;
 await scheduleAttendance(env,now);
 const pending=async()=>(await env.DB.prepare("SELECT a.* FROM attendance_sessions a WHERE confirmed_class IS NOT NULL AND notified=0 AND (attempted IS NOT NULL OR julianday(class_starts)<=julianday(?)) ORDER BY attempted IS NULL,checked LIMIT 1").bind(new Date(now+900000).toISOString()).all()).results;
 let rows=await pending();
 if(!rows.length){
  const upcoming=await env.DB.prepare("SELECT course FROM classes WHERE course<>'WIX1003' AND julianday(starts)<=julianday(?) AND julianday(ends)>julianday(?) ORDER BY starts LIMIT 1").bind(new Date(now+3600000).toISOString(),new Date(now).toISOString()).first();
  const course=upcoming&&(await currentCourses(env.DB)).find(c=>c.code===upcoming.course);
  if(course)try{await refreshAttendance(env,course.id,notify);await scheduleAttendance(env,now);rows=await pending();}catch(e){const message=e instanceof AttendanceError?e.message:'Attendance discovery failed. Check SPeCTRUM manually.';await setting(env.DB,'attendance_error',message);await notify(`attendance-discovery:${course.id}:${new Date(now).toISOString().slice(0,10)}`,{title:`${course.code} · check attendance manually`,body:message,url:'/#settings/attendance'});}
 }
 for(const a of rows){
  const c=await env.DB.prepare('SELECT * FROM classes WHERE id=?').bind(a.confirmed_class).first();
  if(a.course==='WIX1003'||!c||c.starts!==a.class_starts||c.ends!==a.class_ends||c.course!==a.course){await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=NULL,message=? WHERE id=?').bind('Class changed or cancelled · automatic match cleared',a.id).run();continue;}
  if(!a.attempted&&(now<Date.parse(c.starts)-900000||now>Date.parse(c.ends))){if(now>Date.parse(c.ends))await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=NULL,message=? WHERE id=?').bind('Session ended · check SPeCTRUM manually',a.id).run();continue;}
  const claimed=await env.DB.prepare("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind('attendance_lock',String(Date.now()+180000),Date.now()).first();if(!claimed)return;
  try{
   const course={id:a.course_id,code:a.course};
   const {items,numbers}=await modules(env,course);if(!items.some(m=>m.id===a.cmid))throw new AttendanceError('This attendance activity no longer matches your group.');
   const web=await webSession(env);let row=(await report(web,a.cmid,env)).find(r=>r.key===a.row_key);
   if(!row)throw new AttendanceError('The session changed. Open SPeCTRUM to check it.');
   const groups=groupNumbers(row.description,true);if(groups.length&&!groups.some(n=>numbers.includes(n)))throw new AttendanceError('This attendance session belongs to another group.');
   if(row.status){await recordedAttendance(env,notify,a,row.status);continue;}
   if(a.attempted)throw new AttendanceError('Submission result is uncertain. Check SPeCTRUM manually; it will not be submitted again.');
   if(row.password)throw new AttendanceError('Password or QR code required. Mark this session manually.');
   if(!row.open){await env.DB.prepare('UPDATE attendance_sessions SET checked=? WHERE id=?').bind(new Date(now).toISOString(),a.id).run();continue;}
   // Fetching attendance.php can itself record this one session. Persist intent BEFORE making that request.
   if(await setting(env.DB,'attendance_enabled')!=='1')continue;
   const fresh=await env.DB.prepare('SELECT a.confirmed_class,c.starts,c.ends FROM attendance_sessions a LEFT JOIN classes c ON c.id=a.confirmed_class WHERE a.id=?').bind(a.id).first();
   if(fresh?.confirmed_class!==c.id||fresh.starts!==c.starts||fresh.ends!==c.ends)continue;
   await env.DB.prepare('UPDATE attendance_sessions SET attempted=?,session_id=?,message=? WHERE id=?').bind(new Date(now).toISOString(),row.session,'Checking the recorded result',a.id).run();
   const page=await web(`/mod/attendance/attendance.php?sessid=${row.session}&lang=en`);
   if(!loggedIn(page))throw new AttendanceError('Attendance sign-in expired. Check SPeCTRUM manually.');
   const body=simpleForm(page.html,row.session);
   if(body){
    const recorded=(await report(web,a.cmid,env)).find(r=>r.key===a.row_key)?.status;
    if(recorded){await recordedAttendance(env,notify,a,recorded);continue;}
    const current=await env.DB.prepare('SELECT a.confirmed_class,c.starts,c.ends FROM attendance_sessions a LEFT JOIN classes c ON c.id=a.confirmed_class WHERE a.id=?').bind(a.id).first();
    if(await setting(env.DB,'attendance_enabled')!=='1'||current?.confirmed_class!==c.id||current.starts!==c.starts||current.ends!==c.ends)throw new AttendanceError('Auto-marking stopped. Check the session in SPeCTRUM.');
    await web(`/mod/attendance/attendance.php?sessid=${row.session}&lang=en`,body);
   }
   row=(await report(web,a.cmid,env)).find(r=>r.key===a.row_key);
   if(!row?.status)throw new AttendanceError('Attendance could not be verified. A password, QR code, network restriction or unavailable status may require you to mark manually.');
   await recordedAttendance(env,notify,a,row.status);
  }catch(e){
   if((await env.DB.prepare('SELECT recorded FROM attendance_sessions WHERE id=?').bind(a.id).first())?.recorded)continue;
   const message=e instanceof AttendanceError?e.message:'SPeCTRUM could not be checked. Open attendance manually.';
   await env.DB.prepare('UPDATE attendance_sessions SET message=?,confirmed_class=NULL WHERE id=?').bind(message,a.id).run();
   await notify(`attendance-attention:${a.id}`,{title:`${a.course} · attendance needs you`,body:message,url:'/#settings/attendance'});
  }finally{await env.DB.prepare("DELETE FROM settings WHERE key='attendance_lock'").run();}
 }
}
