import {RecordError,updateTask,removeRecord,restoreRecord,removedRecords} from './records.js';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {session,sign,digest,validPush,validDate} from './security.js';
import {setting,connect,syncCourse,currentCourses} from './moodle.js';
import {previewSemester,applySemester,SemesterError} from './semester.js';
import {allowedScope} from './course-scope.js';
import {AttendanceError,pairAttendance,acceptAttendanceHandoff,connectAttendanceQr,checkAttendanceSupport,attendanceState,connectAttendance,refreshAttendance,setAttendanceEnabled,confirmAttendance,attendanceTick} from './attendance.js';
const json=(v,status=200,extra={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...extra}});
export function reminderKey(type,item,sub){return `${type}:${item.id}:${item.due||item.starts}:${item.reminder_minutes}:${sub}`;}
export function reminderDue(item,now){const end=Date.parse(item.due||item.starts);return end>now&&end-item.reminder_minutes*60000<=now;}
async function queue(env,id,payload,due=new Date().toISOString(),deviceId=null){
 const subs=(await env.DB.prepare('SELECT id FROM subscriptions WHERE ? IS NULL OR id=?').bind(deviceId,deviceId).all()).results;
 for(const s of subs)await env.DB.prepare('INSERT OR IGNORE INTO deliveries (id,subscription_id,payload,due) VALUES (?,?,?,?)').bind(`${id}:${s.id}`,s.id,JSON.stringify(payload),due).run();
}
async function deliver(env,deviceId=null){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)return;
 const rows=(await env.DB.prepare('SELECT d.*,s.value FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE d.sent IS NULL AND d.attempts<5 AND d.due<=? AND (? IS NULL OR d.subscription_id=?) ORDER BY d.due LIMIT 3').bind(new Date().toISOString(),deviceId,deviceId).all()).results;
 for(const d of rows){
  const lockKey=`delivery-lock:${d.id}`;
  const claimed=await env.DB.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<? RETURNING key').bind(lockKey,String(Date.now()+90000),Date.now()).first();
  if(!claimed)continue;
  // Retry at minute intervals; each subscription has its own delivery record.
  try{
   const payload=JSON.parse(d.payload);
   if((payload.scope&&!await allowedScope(env.DB,payload.scope))||(!payload.scope&&/^(task:assign-|module:|post:|section:|deadline:)/.test(d.id))){await env.DB.prepare('DELETE FROM deliveries WHERE id=?').bind(d.id).run();continue;}
   const sub=JSON.parse(d.value);if(!validPush(sub))throw new Error('Invalid push endpoint');
   const req=await buildPushPayload({data:{...payload,tag:await digest(d.id)},options:{ttl:3600,urgency:'normal'}},sub,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
   const r=await fetch(sub.endpoint,{...req,signal:AbortSignal.timeout(10000)});
   if(r.status===404||r.status===410){await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(d.subscription_id).run();await env.DB.prepare('DELETE FROM deliveries WHERE subscription_id=?').bind(d.subscription_id).run();continue;}
   if(!r.ok)throw new Error(`Push service returned ${r.status}`);
   await env.DB.prepare('UPDATE deliveries SET sent=?,error=NULL WHERE id=?').bind(new Date().toISOString(),d.id).run();
  }catch(e){await env.DB.prepare('UPDATE deliveries SET attempts=attempts+1,error=? WHERE id=?').bind(e.message.slice(0,150),d.id).run();}
  finally{await env.DB.prepare('DELETE FROM settings WHERE key=?').bind(lockKey).run();}
 }
}
export async function tick(env,now=Date.now()){
 // Keep attendance and course collection on separate minutes within the free Worker query budget.
 if(Math.floor(now/60000)%2===1)try{await attendanceTick(env,(id,payload)=>queue(env,id,payload),now);}catch{await setting(env.DB,'attendance_error','Attendance checks failed. Check SPeCTRUM manually.');}
 const tasks=(await env.DB.prepare("SELECT t.* FROM tasks t WHERE status NOT IN ('submitted','done') AND (source<>'SPeCTRUM' OR EXISTS (SELECT 1 FROM content_scopes s WHERE s.id='module:'||substr(t.id,8) AND s.allowed=1))").all()).results;
 const classes=(await env.DB.prepare('SELECT * FROM classes WHERE ends>?').bind(new Date(now).toISOString()).all()).results;
 for(const [kind,items] of [['task',tasks],['class',classes]])for(const item of items)if(reminderDue(item,now))await queue(env,`${kind}:${item.id}:${item.due||item.starts}:${item.reminder_minutes}`,{title:kind==='task'?`${item.course} · deadline approaching`:`${item.course} · class soon`,body:kind==='task'?item.title:`${item.kind} · ${item.room||'Room not specified'}. Remember attendance.`,url:kind==='task'?'/#tasks':'/#timetable',scope:kind==='task'&&item.source==='SPeCTRUM'?`module:${item.id.slice(7)}`:undefined});
 await deliver(env);
 if(Math.floor(now/60000)%2===0){
  try{const events=await syncCourse(env,Math.floor(now/120000));for(const e of events||[])await queue(env,e.id,{title:`${e.course} · ${e.title}`,body:e.body.slice(0,160),url:'/#updates',scope:e.scope});}
  catch(e){await setting(env.DB,'connection',e.message);const key=`sync-error:${new Date(now).toISOString().slice(0,10)}`;await queue(env,key,{title:'SPeCTRUM needs attention',body:'Course checks paused or failed. Open Settings to check the connection. Saved reminders continue.',url:'/#settings'});}
 }
 await setting(env.DB,'last_tick',new Date(now).toISOString());
 // Bound personal data history and queue growth.
 await env.DB.prepare('DELETE FROM deliveries WHERE sent IS NOT NULL AND sent<?').bind(new Date(now-7*86400000).toISOString()).run();
}
async function api(request,env,url){
 if(url.pathname==='/api/version'&&request.method==='GET')return json({release:env.APP_RELEASE||'development'});
 if(!env.APP_PASSWORD||!env.AUTH_SECRET)return json({error:'Private access is not configured yet. Set APP_PASSWORD and AUTH_SECRET on the server.'},503);
 if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Request origin was not accepted.'},403);
 if(Number(request.headers.get('Content-Length')||0)>24000)return json({error:'Request too large'},413);
 let data={};if(request.method==='POST'){try{const raw=await request.text();if(raw.length>24000)return json({error:'Request too large'},413);data=JSON.parse(raw||'{}');}catch{return json({error:'Invalid request'},400);}}
 if(url.pathname==='/api/login'&&request.method==='POST'){
  const ip=await digest((request.headers.get('CF-Connecting-IP')||'local')+env.AUTH_SECRET);const k=`login:${ip}`;
  let limiter=JSON.parse(await setting(env.DB,k)||'{"n":0,"until":0}');if(limiter.until<Date.now())limiter={n:0,until:Date.now()+900000};
  if(limiter.n>=8)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
  if(typeof data.password!=='string'||await digest(data.password)!==await digest(env.APP_PASSWORD)){limiter.n++;await setting(env.DB,k,JSON.stringify(limiter));return json({error:'That passphrase was not recognised.'},401);}
  await setting(env.DB,k,JSON.stringify({n:0,until:0}));const exp=String(Date.now()+30*86400000);
  return json({ok:true},200,{'Set-Cookie':`sm_session=${exp}.${await sign(exp,env.AUTH_SECRET)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`});
 }
 if(url.pathname==='/api/attendance-handoff'&&request.method==='POST')return json(await acceptAttendanceHandoff(env,data));
 if(!await session(request,env.AUTH_SECRET))return json({error:'Sign in to your private planner.'},401);
 if(url.pathname==='/api/state'&&request.method==='GET'){
  const [tasks,classes,updates,subs]=await Promise.all(["SELECT t.* FROM tasks t WHERE source<>'SPeCTRUM' OR EXISTS (SELECT 1 FROM content_scopes s WHERE s.id='module:'||substr(t.id,8) AND s.allowed=1) ORDER BY due",'SELECT c.*,o.semester_id FROM classes c LEFT JOIN class_occurrences o ON o.class_id=c.id ORDER BY julianday(c.starts)','SELECT u.* FROM updates u LEFT JOIN update_scopes us ON us.update_id=u.id LEFT JOIN content_scopes s ON s.id=us.scope_id LEFT JOIN content_scopes p ON p.id=s.parent_id WHERE us.scope_id IS NULL OR (s.allowed=1 AND (s.parent_id IS NULL OR p.allowed=1)) ORDER BY changed DESC LIMIT 60','SELECT COUNT(*) AS n FROM subscriptions'].map(q=>env.DB.prepare(q).all()));
  const partial=(await env.DB.prepare("SELECT key,value FROM settings WHERE key LIKE 'partial:%'").all()).results;
  const semesters=(await env.DB.prepare('SELECT * FROM semesters ORDER BY id').all()).results.map(s=>({...JSON.parse(s.definition),revision:s.revision}));
  return json({courses:await currentCourses(env.DB),tasks:tasks.results,classes:classes.results,updates:updates.results,semesters,removed:await removedRecords(env.DB,semesters),connected:!!await setting(env.DB,'moodle_token'),attendance:await attendanceState(env),release:env.APP_RELEASE||'development',subscriptions:subs.results[0].n,pushKey:env.VAPID_PUBLIC_KEY||null,pushReady:!!env.VAPID_PRIVATE_KEY,connection:await setting(env.DB,'connection')||'Not connected · imported records only',lastSync:await setting(env.DB,'last_sync'),lastTick:await setting(env.DB,'last_tick'),partial});
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 switch(url.pathname){
 case '/api/attendance-qr':return json(await connectAttendanceQr(env,data.url));
 case '/api/attendance-pair':return json(await pairAttendance(env));
 case '/api/attendance-support':return json(await checkAttendanceSupport(env));
 case '/api/attendance-connect':await connectAttendance(env,data);return json({ok:true});
 case '/api/attendance-enabled':await setAttendanceEnabled(env,data.enabled);return json({ok:true});
 case '/api/attendance-refresh':await refreshAttendance(env,data.courseId);return json({ok:true});
 case '/api/attendance-confirm':await confirmAttendance(env,data);return json({ok:true});
 case '/api/attendance-cancel':await env.DB.prepare('UPDATE attendance_sessions SET confirmed_class=NULL,message=? WHERE id=?').bind('Confirmation withdrawn',data.id).run();return json({ok:true});
 case '/api/attendance-disconnect':await setAttendanceEnabled(env,false);await env.DB.prepare("DELETE FROM settings WHERE key IN ('attendance_cookie','attendance_connection','attendance_mobile','attendance_pair')").run();return json({ok:true});
 case '/api/semester-preview':
 case '/api/semester-apply':{
  try{return json(url.pathname.endsWith('preview')?await previewSemester(env.DB,data.definition):await applySemester(env.DB,data.definition,data.token));}
  catch(e){if(e instanceof SemesterError)return json({error:e.message},/changed/.test(e.message)?409:400);if(e.message.includes('semesters.revision'))return json({error:'This semester changed. Preview it again before saving.'},409);throw e;}
 }
 case '/api/logout':return json({ok:true},200,{'Set-Cookie':'sm_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});
 case '/api/tasks':{
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>180||!validDate(data.due)||!data.course)return json({error:'Enter a course, title, and valid due date.'},400);
  if(data.id&&(typeof data.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)))return json({error:'Invalid save identifier. Close this form and try again.'},400);
  const id=data.id||crypto.randomUUID(),course=String(data.course).slice(0,50),title=data.title.trim(),due=new Date(data.due).toISOString(),reminder=Math.max(0,Math.min(10080,Number(data.reminder_minutes)||120));
  // Keep the form's ID across retries so a lost response cannot create a second deadline.
  await env.DB.prepare('INSERT INTO tasks (id,course,title,due,status,source,reminder_minutes) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,course,title,due,'pending','manual',reminder).run();
  const saved=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();
  if(!saved||saved.source!=='manual'||saved.course!==course||saved.title!==title||saved.due!==due||saved.reminder_minutes!==reminder)return json({error:'An earlier version of this deadline was already saved. Close this form and refresh to review it before making another change.'},409);
  return json({ok:true});
 }
 case '/api/task-status':{
  const t=await env.DB.prepare('SELECT source FROM tasks WHERE id=?').bind(data.id).first();if(!t||t.source!=='manual')return json({error:'SPeCTRUM submission status must be confirmed by SPeCTRUM.'},400);
  await env.DB.prepare('UPDATE tasks SET status=? WHERE id=?').bind(data.done?'done':'pending',data.id).run();if(data.done)await env.DB.prepare("DELETE FROM deliveries WHERE sent IS NULL AND id LIKE ?").bind(`task:${data.id}:%`).run();return json({ok:true});
 }
 case '/api/task-update':return json(await updateTask(env.DB,data));
 case '/api/task-delete':return json(await removeRecord(env.DB,'task',data.id));
 case '/api/restore':return json(await restoreRecord(env.DB,data.type,data.id));
 case '/api/classes':{
  if(!data.course||!validDate(data.starts)||!validDate(data.ends)||Date.parse(data.ends)<=Date.parse(data.starts))return json({error:'Choose a course and an end time after the start time.'},400);
  const id=data.id||crypto.randomUUID();await env.DB.batch([
   env.DB.prepare('INSERT OR REPLACE INTO classes (id,course,kind,starts,ends,room,occ,source,reminder_minutes) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,String(data.course).slice(0,50),String(data.kind||'Class').slice(0,30),new Date(data.starts).toISOString(),new Date(data.ends).toISOString(),String(data.room||'').slice(0,160),String(data.occ||'').slice(0,30),'manual',15),
   env.DB.prepare('UPDATE class_occurrences SET overridden=1,cancelled=0 WHERE class_id=?').bind(id),
   env.DB.prepare("DELETE FROM deliveries WHERE sent IS NULL AND substr(id,1,length(?)+7)='class:'||?||':'").bind(id,id)
  ]);return json({ok:true});
 }
 case '/api/class-delete':return json(await removeRecord(env.DB,'class',data.id));
 case '/api/seen':await env.DB.prepare('UPDATE updates SET seen=1 WHERE id=?').bind(data.id).run();return json({ok:true});
 case '/api/subscribe':if(!validPush(data))return json({error:'Unsupported push subscription'},400);await env.DB.prepare('INSERT OR REPLACE INTO subscriptions VALUES (?,?)').bind(await digest(data.endpoint),JSON.stringify(data)).run();return json({ok:true});
 case '/api/unsubscribe':await env.DB.prepare('DELETE FROM subscriptions WHERE id=?').bind(await digest(String(data.endpoint))).run();return json({ok:true});
 case '/api/push-status':
 case '/api/push-test':
 case '/api/deliveries':{
  if(typeof data.endpoint!=='string'||!data.endpoint||data.endpoint.length>2048)return json({error:'Check notification setup on this device first.'},400);
  const id=await digest(data.endpoint),sub=await env.DB.prepare('SELECT id FROM subscriptions WHERE id=?').bind(id).first();
  if(url.pathname==='/api/push-status')return json({subscribed:!!sub});
  if(!sub)return json({error:'Enable notifications on this device first.'},400);
  if(url.pathname==='/api/deliveries')return json((await env.DB.prepare('SELECT id,sent,attempts,error,due FROM deliveries WHERE subscription_id=? ORDER BY due DESC LIMIT 10').bind(id).all()).results);
  await queue(env,`test:${crypto.randomUUID()}`,{title:'Your planner is working',body:'This test was sent only to this device by your cloud reminder service.',url:'/#settings/notifications'},new Date(Date.now()+(data.delayed?120000:0)).toISOString(),id);
  if(!data.delayed)await deliver(env,id);
  return json({ok:true,message:data.delayed?'Test queued for this device in two minutes. Close the app, then check this device.':'Test request processed for this device. Check its notifications and delivery details.'});
 }
 case '/api/connect':{const courses=await connect(env,data.token);await setAttendanceEnabled(env,false);await env.DB.prepare("DELETE FROM settings WHERE key IN ('attendance_cookie','attendance_connection','attendance_mobile','attendance_pair')").run();return json({ok:true,courses});}
 case '/api/sync':{const events=await syncCourse(env,0);for(const e of events||[])await queue(env,e.id,{title:e.title,body:e.body.slice(0,160),url:'/#updates',scope:e.scope});return json({ok:true});}
 case '/api/disconnect':await setAttendanceEnabled(env,false);await env.DB.prepare("DELETE FROM settings WHERE key IN ('moodle_token','connection','courses','attendance_cookie','attendance_connection','attendance_mobile','attendance_pair')").run();return json({ok:true});
 default:return json({error:'Not found'},404);
 }
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);let response;
  try{response=url.pathname.startsWith('/api/')?await api(request,env,url):await env.ASSETS.fetch(request);}catch(e){response=json({error:e instanceof AttendanceError||e instanceof RecordError||e.message.startsWith('SPeCTRUM')?e.message:'The request could not be completed. Please try again.'},e instanceof RecordError?e.status:e instanceof AttendanceError?400:500);}
  const h=new Headers(response.headers);h.set('X-Content-Type-Options','nosniff');h.set('Referrer-Policy','no-referrer');h.set('X-Frame-Options','DENY');h.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers:h});
 },
 async scheduled(event,env,ctx){ctx.waitUntil(tick(env));}
};
