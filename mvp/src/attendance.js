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
 return async function web(path,body){
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
}
function loggedIn(page){return !/name=["'](?:password|logintoken)["']/i.test(page.html)&&/\/login\/logout\.php\?[^"']*sesskey=/.test(page.html);}
export async function checkAttendanceSupport(env){
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
export function simpleForm(html,session){
 const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].filter(m=>inputs(m[1]).some(i=>i.name==='sessid'&&i.value===String(session)));
 if(forms.length!==1)return null;
 const fields=inputs(forms[0][1]);if(fields.some(i=>['studentpassword','qrpass'].includes(i.name)))return null;
 const present=fields.filter(i=>i.name==='status'&&i.type==='radio'&&!i.disabled).filter(i=>{
  const id=i.id?.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(!id)return false;
  const label=forms[0][1].match(new RegExp(`<label\\b[^>]*for=["']${id}["'][^>]*>([\\s\\S]*?)<\\/label>`,'i'));
  return label&&/^(Present|Hadir)$/i.test(text(label[1]));
 });
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
async function report(web,cmid){const page=await web(`/mod/attendance/view.php?id=${cmid}&view=5&lang=en`);if(!loggedIn(page))throw new AttendanceError('Attendance sign-in expired. Reconnect in Settings.');return parseReport(page.html);}
export async function attendanceState(env){
 const config=Object.fromEntries((await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('attendance_enabled','attendance_connection','attendance_checked','attendance_error')").all()).results.map(r=>[r.key,r.value]));
 return {enabled:config.attendance_enabled==='1',connected:config.attendance_connection==='Connected',connection:config.attendance_connection||'Not connected',lastCheck:config.attendance_checked||null,error:config.attendance_error||'',sessions:(await env.DB.prepare("SELECT * FROM attendance_sessions WHERE day>=? ORDER BY day,label LIMIT 80").bind(new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10)).all()).results};
}
export async function refreshAttendance(env,courseid,notify=async()=>{}){
 const course=(await currentCourses(env.DB)).find(c=>c.id===Number(courseid));if(!course)throw new AttendanceError('Choose a connected course.');
 if(course.code==='WIX1003')return;
 if(!await setting(env.DB,'attendance_cookie'))throw new AttendanceError('Connect attendance in Settings first.');
 const {items:available,numbers}=await modules(env,course),web=await webSession(env),day=new Date(Date.now()+8*3600000).toISOString().slice(0,10),until=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10);
 const writes=[];
 for(const m of available){
  const rows=await report(web,m.id);
  for(const row of rows){const date=sessionDate(row.label),groups=groupNumbers(row.description,true);if(!date||date<day||date>until||groups.length&&!groups.some(n=>numbers.includes(n)))continue;
   const id=await digest(`${m.id}:${row.key}`);
   writes.push(env.DB.prepare('INSERT INTO attendance_sessions (id,course,course_id,cmid,name,row_key,day,label,session_id,recorded,manual,checked) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,recorded=excluded.recorded,manual=excluded.manual,checked=excluded.checked').bind(id,course.code,course.id,m.id,text(m.name),row.key,date,row.label,row.session,row.status,row.password?1:0,new Date().toISOString()));
   if(row.open&&!row.status)await notify(`attendance-open:${id}`,{title:`${course.code} · attendance is open`,body:`${row.label}. Confirm you are attending in the planner.`,url:'/#settings/timetable'});
  }
 }
 // Removed or hidden activities must never retain permission to mark.
 writes.push(env.DB.prepare('DELETE FROM attendance_sessions WHERE attempted IS NULL AND course_id=?'+(available.length?' AND cmid NOT IN ('+available.map(()=>'?').join(',')+')':'')).bind(course.id,...available.map(m=>m.id)));
 writes.push(env.DB.prepare('DELETE FROM attendance_sessions WHERE day<? AND attempted IS NULL').bind(day));
 if(writes.length)await env.DB.batch(writes);
 await setting(env.DB,'attendance_checked',new Date().toISOString());await setting(env.DB,'attendance_error','');
}
export async function setAttendanceEnabled(env,enabled){
 if(typeof enabled!=='boolean')throw new AttendanceError('Choose on or off.');
 if(enabled&&await setting(env.DB,'attendance_connection')!=='Connected')throw new AttendanceError('Connect attendance before enabling auto-marking.');
 await env.DB.batch([env.DB.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind('attendance_enabled',enabled?'1':'0'),env.DB.prepare("UPDATE attendance_sessions SET confirmed_class=NULL,message='Confirmation cleared' WHERE attempted IS NULL AND confirmed_class IS NOT NULL")]);
}
export async function confirmAttendance(env,{id,classId}){
 if(await setting(env.DB,'attendance_enabled')!=='1')throw new AttendanceError('Enable auto-marking in Settings first.');
 const row=await env.DB.prepare('SELECT * FROM attendance_sessions WHERE id=?').bind(id).first();
 const c=await env.DB.prepare('SELECT * FROM classes WHERE id=?').bind(classId).first();
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 if(!row||!c||row.course==='WIX1003'||row.course!==c.course||row.day!==today||new Date(Date.parse(c.starts)+8*3600000).toISOString().slice(0,10)!==row.day||Date.parse(c.ends)<=Date.now()||row.manual||row.recorded||row.attempted)throw new AttendanceError('Choose an unmarked session for a class you are attending today.');
 await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=?,class_starts=?,class_ends=?,message=? WHERE id=?').bind(c.id,c.starts,c.ends,'Confirmed by you · waiting for an eligible session',id).run();
}

export async function attendanceTick(env,notify,now=Date.now()){
 if(await setting(env.DB,'attendance_enabled')!=='1')return;
 if(!await setting(env.DB,'attendance_cookie'))return;
 const rows=(await env.DB.prepare("SELECT a.* FROM attendance_sessions a WHERE confirmed_class IS NOT NULL AND notified=0 AND (attempted IS NOT NULL OR julianday(class_starts)<=julianday(?)) ORDER BY attempted IS NULL,checked LIMIT 1").bind(new Date(now+900000).toISOString()).all()).results;
 if(!rows.length){
  const upcoming=await env.DB.prepare("SELECT course FROM classes WHERE course<>'WIX1003' AND julianday(starts)<=julianday(?) AND julianday(ends)>julianday(?) ORDER BY starts LIMIT 1").bind(new Date(now+3600000).toISOString(),new Date(now).toISOString()).first();
  const course=upcoming&&(await currentCourses(env.DB)).find(c=>c.code===upcoming.course);
  if(course)try{await refreshAttendance(env,course.id,notify);}catch(e){const message=e instanceof AttendanceError?e.message:'Attendance discovery failed. Check SPeCTRUM manually.';await setting(env.DB,'attendance_error',message);await notify(`attendance-discovery:${course.id}:${new Date(now).toISOString().slice(0,10)}`,{title:`${course.code} · check attendance manually`,body:message,url:'/#settings/timetable'});}
 }
 for(const a of rows){
  const c=await env.DB.prepare('SELECT * FROM classes WHERE id=?').bind(a.confirmed_class).first();
  if(a.course==='WIX1003'||!c||c.starts!==a.class_starts||c.ends!==a.class_ends||c.course!==a.course){await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=NULL,message=? WHERE id=?').bind('Class changed or cancelled · confirmation cleared',a.id).run();continue;}
  if(!a.attempted&&(now<Date.parse(c.starts)-900000||now>Date.parse(c.ends))){if(now>Date.parse(c.ends))await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=NULL,message=? WHERE id=?').bind('Session ended · check SPeCTRUM manually',a.id).run();continue;}
  const claimed=await env.DB.prepare("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key").bind('attendance_lock',String(Date.now()+180000),Date.now()).first();if(!claimed)return;
  try{
   const course={id:a.course_id,code:a.course};
   const {items,numbers}=await modules(env,course);if(!items.some(m=>m.id===a.cmid))throw new AttendanceError('This attendance activity no longer matches your group.');
   const web=await webSession(env);let row=(await report(web,a.cmid)).find(r=>r.key===a.row_key);
   if(!row)throw new AttendanceError('The session changed. Open SPeCTRUM to check it.');
   const groups=groupNumbers(row.description,true);if(groups.length&&!groups.some(n=>numbers.includes(n)))throw new AttendanceError('This attendance session belongs to another group.');
   if(row.status){await finish(row.status);continue;}
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
    const recorded=(await report(web,a.cmid)).find(r=>r.key===a.row_key)?.status;
    if(recorded){await finish(recorded);continue;}
    const current=await env.DB.prepare('SELECT a.confirmed_class,c.starts,c.ends FROM attendance_sessions a LEFT JOIN classes c ON c.id=a.confirmed_class WHERE a.id=?').bind(a.id).first();
    if(await setting(env.DB,'attendance_enabled')!=='1'||current?.confirmed_class!==c.id||current.starts!==c.starts||current.ends!==c.ends)throw new AttendanceError('Auto-marking stopped. Check the session in SPeCTRUM.');
    await web(`/mod/attendance/attendance.php?sessid=${row.session}&lang=en`,body);
   }
   row=(await report(web,a.cmid)).find(r=>r.key===a.row_key);
   if(!row?.status)throw new AttendanceError('Attendance could not be verified. A password, QR code, network restriction or unavailable status may require you to mark manually.');
   await finish(row.status);
   async function finish(status){
    await env.DB.prepare('UPDATE attendance_sessions SET recorded=?,message=? WHERE id=?').bind(status,'Verified in SPeCTRUM',a.id).run();
    await notify(`attendance-result:${a.id}`,{title:`${a.course} · attendance confirmed`,body:`${a.label} · ${status}. Verified in SPeCTRUM.`,url:'/#settings/timetable'});
    await env.DB.prepare('UPDATE attendance_sessions SET notified=1 WHERE id=?').bind(a.id).run();
   }
  }catch(e){
   if((await env.DB.prepare('SELECT recorded FROM attendance_sessions WHERE id=?').bind(a.id).first())?.recorded)continue;
   const message=e instanceof AttendanceError?e.message:'SPeCTRUM could not be checked. Open attendance manually.';
   await env.DB.prepare('UPDATE attendance_sessions SET message=?,confirmed_class=NULL WHERE id=?').bind(message,a.id).run();
   await notify(`attendance-attention:${a.id}`,{title:`${a.course} · attendance needs you`,body:message,url:'/#settings/timetable'});
  }finally{await env.DB.prepare("DELETE FROM settings WHERE key='attendance_lock'").run();}
 }
}
