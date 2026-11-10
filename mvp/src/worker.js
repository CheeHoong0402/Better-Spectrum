import {authenticate,session,logout,authLimit} from './auth.js';
import {userEnvironment,ownerSQL} from './tenant.js';
import {dispatch,consume,schedule,withUserLease} from './jobs.js';
import {RecordError,updateTask,removeRecord,restoreRecord,removedRecords} from './records.js';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import {digest,randomToken,validPush,validDate} from './security.js';
import {setting,connect,syncCourse,currentCourses} from './moodle.js';
import {previewSemester,applySemester,SemesterError} from './semester.js';
import {allowedScope} from './course-scope.js';
import {AttendanceError,pairAttendance,acceptAttendanceHandoff,connectAttendanceQr,checkAttendanceSupport,attendanceState,connectAttendance,refreshAttendance,setAttendanceEnabled,confirmAttendance,attendanceTick} from './attendance.js';
const json=(v,status=200,extra={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...extra}});
export function reminderKey(type,item,sub){return `${type}:${item.id}:${item.due||item.starts}:${item.reminder_minutes}:${sub}`;}
export function reminderDue(item,now){const end=Date.parse(item.due||item.starts);return end>now&&end-item.reminder_minutes*60000<=now;}
export async function queue(env,id,payload,due=new Date().toISOString(),deviceId=null){
 const subs=(await env.DB.prepare(`${ownerSQL} SELECT id FROM subscriptions WHERE user_id=(SELECT id FROM owner) AND device_id IS NOT NULL AND (?2 IS NULL OR id=?3)`).bind(deviceId,deviceId).all()).results;
 for(const s of subs)await env.DB.prepare(`${ownerSQL} INSERT OR IGNORE INTO deliveries (user_id,id,subscription_id,payload,due) VALUES ((SELECT id FROM owner),?2,?3,?4,?5)`).bind(`${id}:${s.id}`,s.id,JSON.stringify({url:payload.url,scope:payload.scope,item:payload.item,title:'Better Spectrum',body:'Your planner has an update. Open it to view details.'}),due).run();
 return subs.length;
}
export async function deliver(env,deviceId=null){
 if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)return;
 const rows=(await env.DB.prepare(`${ownerSQL} SELECT d.*,s.value FROM (SELECT * FROM deliveries WHERE user_id=(SELECT id FROM owner)) d JOIN (SELECT * FROM subscriptions WHERE user_id=(SELECT id FROM owner)) s ON s.id=d.subscription_id WHERE d.sent IS NULL AND d.attempts<5 AND d.due<=?2 AND (?3 IS NULL OR d.subscription_id=?4) ORDER BY d.due LIMIT 3`).bind(new Date().toISOString(),deviceId,deviceId).all()).results;
 for(const d of rows){
  const lease=randomToken();
  const claimed=await env.DB.prepare(`${ownerSQL} UPDATE deliveries SET lease=?2,lease_until=?3 WHERE user_id=(SELECT id FROM owner) AND id=?4 AND sent IS NULL AND (lease_until IS NULL OR lease_until<?5) RETURNING id`).bind(lease,Date.now()+90000,d.id,Date.now()).first();
  if(!claimed)continue;
  // Retry at minute intervals; each subscription has its own delivery record.
  try{
   const payload=JSON.parse(d.payload);
   if((payload.scope&&!await allowedScope(env.DB,payload.scope))||(!payload.scope&&/^(task:assign-|module:|post:|section:|deadline:)/.test(d.id))){await env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (id=?2) `).bind(d.id).run();continue;}
   if(payload.item){const {kind,id,time,reminder}=payload.item,table=kind==='task'?'tasks':'classes',date=kind==='task'?'due':'starts';
    const current=await env.DB.prepare(`${ownerSQL} SELECT * FROM ${table} WHERE user_id=(SELECT id FROM owner) AND id=?2 AND ${date}=?3 AND reminder_minutes=?4`).bind(id,time,reminder).first();
    if(!current||(kind==='task'&&['done','submitted'].includes(current.status))){await env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND id=?2`).bind(d.id).run();continue;}
   }
   const sub=JSON.parse(d.value);if(!validPush(sub))throw new Error('Invalid push endpoint');
   const req=await buildPushPayload({data:{title:'Better Spectrum',body:'Your planner has an update. Open it to view details.',url:payload.url,tag:await digest(env.userId+':'+d.id)},options:{ttl:3600,urgency:'normal'}},sub,{subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY});
   const r=await fetch(sub.endpoint,{...req,signal:AbortSignal.timeout(10000)});
   if(r.status===404||r.status===410){await env.DB.prepare(`${ownerSQL} DELETE FROM subscriptions WHERE user_id=(SELECT id FROM owner) AND (id=?2) `).bind(d.subscription_id).run();await env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (subscription_id=?2) `).bind(d.subscription_id).run();continue;}
   if(!r.ok)throw new Error(`Push service returned ${r.status}`);
   await env.DB.prepare(`${ownerSQL} UPDATE deliveries SET sent=?2,error=NULL WHERE user_id=(SELECT id FROM owner) AND (id=?3) `).bind(new Date().toISOString(),d.id).run();
  }catch(e){await env.DB.prepare(`${ownerSQL} UPDATE deliveries SET attempts=attempts+1,error=?2 WHERE user_id=(SELECT id FROM owner) AND (id=?3) `).bind(e.message.slice(0,150),d.id).run();}
  finally{await env.DB.prepare(`${ownerSQL} UPDATE deliveries SET lease=NULL,lease_until=NULL WHERE user_id=(SELECT id FROM owner) AND id=?2 AND lease=?3`).bind(d.id,lease).run();}
 }
}
export async function reminders(env,now=Date.now()){
 const tasks=(await env.DB.prepare(`${ownerSQL} SELECT t.* FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) t WHERE remind_at<=?2 AND due>?3 AND status NOT IN ('submitted','done') AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) r WHERE r.key='removed:task:'||t.id) AND (source<>'SPeCTRUM' OR EXISTS (SELECT 1 FROM (SELECT * FROM content_scopes WHERE user_id=(SELECT id FROM owner)) s WHERE s.id='module:'||substr(t.id,8) AND s.allowed=1)) ORDER BY remind_at LIMIT 80`).bind(now,new Date(now).toISOString()).all()).results;
 const classes=(await env.DB.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM classes WHERE user_id=(SELECT id FROM owner)) classes WHERE remind_at<=?2 AND starts>?3 ORDER BY remind_at LIMIT 80`).bind(now,new Date(now).toISOString()).all()).results;
 for(const [kind,items] of [['task',tasks],['class',classes]])for(const item of items)if(reminderDue(item,now)){
  const time=item.due||item.starts;
  const count=await queue(env,`${kind}:${item.id}:${time}:${item.reminder_minutes}`,{url:kind==='task'?'/#tasks':'/#timetable',scope:kind==='task'&&item.source==='SPeCTRUM'?`module:${item.id.slice(7)}`:undefined,item:{kind,id:item.id,time,reminder:item.reminder_minutes}});
  if(count)await env.DB.prepare(`${ownerSQL} UPDATE ${kind==='task'?'tasks':'classes'} SET remind_at=NULL WHERE user_id=(SELECT id FROM owner) AND id=?2 AND ${kind==='task'?'due':'starts'}=?3 AND reminder_minutes=?4`).bind(item.id,time,item.reminder_minutes).run();
 }

 await setting(env.DB,'last_tick',new Date(now).toISOString());
}
export const tick=dispatch;
async function executeJob(env,job){
 if(job.kind==='sync'){try{const events=await syncCourse(env,0,job.target);for(const e of events||[])await queue(env,e.id,{url:'/#updates',scope:e.scope});}catch(error){await setting(env.DB,'connection',error.message.startsWith('SPeCTRUM')?error.message:'Course checks failed. Reconnect or try again.');throw error;}}
 else if(job.kind==='attendance')await attendanceTick(env,(id,payload)=>queue(env,id,payload));
 else if(job.kind==='reminders')await reminders(env);
 else if(job.kind==='deliver')await deliver(env,job.target);
 else throw new Error('Unknown background job');
 await setting(env.DB,'last_tick',new Date().toISOString());
}
async function api(request,env,url){
 if(url.pathname==='/api/version'&&request.method==='GET')return json({release:env.APP_RELEASE||'development',maintenance:env.MAINTENANCE==='1'});
 if(env.MAINTENANCE==='1')return json({error:'Your planner is being upgraded. Please try again shortly.'},503);
 if(!env.DATA_ENCRYPTION_KEY)return json({error:'Private access is not configured yet.'},503);
 if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({error:'Request origin was not accepted.'},403);
 if(Number(request.headers.get('Content-Length')||0)>24000)return json({error:'Request too large'},413);
 let data={};if(request.method==='POST'){try{const raw=await request.text();if(raw.length>24000)return json({error:'Request too large'},413);data=JSON.parse(raw||'{}');}catch{return json({error:'Invalid request'},400);}}
 if(!data||typeof data!=='object'||Array.isArray(data))return json({error:'Invalid request'},400);
 if(['/api/auth/start','/api/auth/verify'].includes(url.pathname)&&request.method==='POST')return authenticate(request,env,data,url.pathname.endsWith('/verify'));
 if(['/api/login','/api/spectrum-login-start','/api/spectrum-login-finish'].includes(url.pathname))return json({error:'Sign in with your invited email address.',loginMethod:'email'},401);
 if(url.pathname==='/api/attendance-handoff'&&request.method==='POST'){
  await authLimit(env,'handoff:'+(request.headers.get('CF-Connecting-IP')||'local'),20);
  if(typeof data.code!=='string'||data.code.length!==72)return json({error:'Invalid pairing code.'},400);
  const pair=await env.DB.prepare("SELECT u.* FROM attendance_pairings p JOIN users u ON u.id=p.user_id WHERE p.id=? AND p.claimed=0 AND p.expires>? AND u.status='active'").bind(await digest(data.code),Date.now()).first();
  if(!pair)return json({error:'Pairing code expired or was already used.'},400);
  return withUserLease(env,pair,async scoped=>json(await acceptAttendanceHandoff(scoped,data)));
 }
 const user=await session(request,env.DB);
 if(!user)return json({error:'Sign in to your private planner.',loginMethod:'email'},401);
 if(url.pathname==='/api/me'&&request.method==='GET')return json({user:{id:user.id,email:user.email}});
 if(request.headers.get('X-Planner-User')!==user.id)return json({error:'The signed-in account changed. Sign in again before continuing.',identityChanged:true},409);
 if(url.pathname==='/api/logout'&&request.method==='POST')return logout(request,env,user);
 const root=env;
 env=userEnvironment(env,user);
 if(url.pathname==='/api/state'&&request.method==='GET'){
  const [tasks,classes,updates,subs]=await Promise.all([
   env.DB.prepare(`${ownerSQL} SELECT t.* FROM tasks t WHERE t.user_id=(SELECT id FROM owner) AND NOT EXISTS (SELECT 1 FROM user_settings r WHERE r.user_id=(SELECT id FROM owner) AND r.key='removed:task:'||t.id) AND (source<>'SPeCTRUM' OR EXISTS (SELECT 1 FROM content_scopes s WHERE s.user_id=(SELECT id FROM owner) AND s.id='module:'||substr(t.id,8) AND s.allowed=1)) ORDER BY due`).all(),
   env.DB.prepare(`${ownerSQL} SELECT c.*,o.semester_id FROM classes c LEFT JOIN class_occurrences o ON o.user_id=c.user_id AND o.class_id=c.id WHERE c.user_id=(SELECT id FROM owner) ORDER BY julianday(c.starts)`).all(),
   env.DB.prepare(`${ownerSQL} SELECT u.* FROM updates u LEFT JOIN update_scopes us ON us.user_id=u.user_id AND us.update_id=u.id LEFT JOIN content_scopes s ON s.user_id=u.user_id AND s.id=us.scope_id LEFT JOIN content_scopes p ON p.user_id=u.user_id AND p.id=s.parent_id WHERE u.user_id=(SELECT id FROM owner) AND (us.scope_id IS NULL OR (s.allowed=1 AND (s.parent_id IS NULL OR p.allowed=1))) ORDER BY changed DESC LIMIT 60`).all(),
   env.DB.prepare(`${ownerSQL} SELECT COUNT(*) AS n FROM subscriptions WHERE user_id=(SELECT id FROM owner)`).all()
  ]);
  const partial=(await env.DB.prepare(`${ownerSQL} SELECT key,value FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) user_settings WHERE key LIKE 'partial:%'`).all()).results;
  const semesters=(await env.DB.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM semesters WHERE user_id=(SELECT id FROM owner)) semesters ORDER BY id`).all()).results.map(s=>({...JSON.parse(s.definition),revision:s.revision}));
  return json({user:{id:user.id,email:user.email},courses:await currentCourses(env.DB),tasks:tasks.results,classes:classes.results,updates:updates.results,semesters,removed:await removedRecords(env.DB,semesters),connected:!!await setting(env.DB,'moodle_token'),attendance:await attendanceState(env),release:env.APP_RELEASE||'development',subscriptions:subs.results[0].n,pushKey:env.VAPID_PUBLIC_KEY||null,pushReady:!!env.VAPID_PRIVATE_KEY,connection:await setting(env.DB,'connection')||'Not connected · imported records only',lastSync:await setting(env.DB,'last_sync'),lastTick:await setting(env.DB,'last_tick'),partial});
 }
 if(request.method!=='POST')return json({error:'Not found'},404);
 switch(url.pathname){
 case '/api/attendance-qr':return withUserLease(root,user,async scoped=>json(await connectAttendanceQr(scoped,data.url)));
 case '/api/attendance-pair':return json(await pairAttendance(env));
 case '/api/attendance-support':return json(await checkAttendanceSupport(env));
 case '/api/attendance-connect':return withUserLease(root,user,async scoped=>{await connectAttendance(scoped,data);return json({ok:true});});
 case '/api/attendance-enabled':await setAttendanceEnabled(env,data.enabled);return json({ok:true});
 case '/api/attendance-refresh':return withUserLease(root,user,async scoped=>{await refreshAttendance(scoped,data.courseId);return json({ok:true});});
 case '/api/attendance-confirm':await confirmAttendance(env,data);return json({ok:true});
 case '/api/attendance-cancel':await env.DB.prepare(`${ownerSQL} UPDATE attendance_sessions SET confirmed_class=NULL,message=?2 WHERE user_id=(SELECT id FROM owner) AND (id=?3) `).bind('Skipped by you',data.id).run();return json({ok:true});
 case '/api/attendance-disconnect':await root.DB.prepare('UPDATE users SET generation=generation+1 WHERE id=?').bind(user.id).run();await clearAttendance(userEnvironment(root,{...user,generation:user.generation+1}));return json({ok:true});
 case '/api/semester-preview':
 case '/api/semester-apply':{
  try{return json(url.pathname.endsWith('preview')?await previewSemester(env.DB,data.definition):await applySemester(env.DB,data.definition,data.token));}
  catch(e){if(e instanceof SemesterError)return json({error:e.message},/changed/.test(e.message)?409:400);if(e.message.includes('semesters.revision'))return json({error:'This semester changed. Preview it again before saving.'},409);throw e;}
 }

 case '/api/tasks':{
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>180||!validDate(data.due)||!data.course)return json({error:'Enter a course, title, and valid due date.'},400);
  if(data.id&&(typeof data.id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.id)))return json({error:'Invalid save identifier. Close this form and try again.'},400);
  const id=data.id||crypto.randomUUID(),course=String(data.course).slice(0,50),title=data.title.trim(),due=new Date(data.due).toISOString(),reminder=Math.max(0,Math.min(10080,Number(data.reminder_minutes)||120));
  // Keep the form's ID across retries so a lost response cannot create a second deadline.
  await env.DB.prepare(`${ownerSQL} INSERT INTO tasks (user_id,id,course,title,due,status,source,reminder_minutes) VALUES ((SELECT id FROM owner),?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(user_id,id) DO NOTHING`).bind(id,course,title,due,'pending','manual',reminder).run();
  const saved=await env.DB.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?2`).bind(id).first();
  if(!saved||saved.source!=='manual'||saved.course!==course||saved.title!==title||saved.due!==due||saved.reminder_minutes!==reminder)return json({error:'An earlier version of this deadline was already saved. Close this form and refresh to review it before making another change.'},409);
  return json({ok:true});
 }
 case '/api/task-status':{
  const t=await env.DB.prepare(`${ownerSQL} SELECT source FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?2`).bind(data.id).first();if(!t||t.source!=='manual')return json({error:'SPeCTRUM submission status must be confirmed by SPeCTRUM.'},400);
  await env.DB.prepare(`${ownerSQL} UPDATE tasks SET status=?2 WHERE user_id=(SELECT id FROM owner) AND (id=?3) `).bind(data.done?'done':'pending',data.id).run();if(data.done)await env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (sent IS NULL AND id LIKE ?2) `).bind(`task:${data.id}:%`).run();return json({ok:true});
 }
 case '/api/task-update':return json(await updateTask(env.DB,data));
 case '/api/task-delete':return json(await removeRecord(env.DB,'task',data.id));
 case '/api/restore':return json(await restoreRecord(env.DB,data.type,data.id));
 case '/api/classes':{
  if(!data.course||!validDate(data.starts)||!validDate(data.ends)||Date.parse(data.ends)<=Date.parse(data.starts))return json({error:'Choose a course and an end time after the start time.'},400);
  const id=data.id||crypto.randomUUID();await env.DB.batch([
   env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO classes (user_id,id,course,kind,starts,ends,room,occ,source,reminder_minutes) VALUES ((SELECT id FROM owner),?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(id,String(data.course).slice(0,50),String(data.kind||'Class').slice(0,30),new Date(data.starts).toISOString(),new Date(data.ends).toISOString(),String(data.room||'').slice(0,160),String(data.occ||'').slice(0,30),'manual',15),
   env.DB.prepare(`${ownerSQL} UPDATE class_occurrences SET overridden=1,cancelled=0 WHERE user_id=(SELECT id FROM owner) AND (class_id=?2) `).bind(id),
   env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (sent IS NULL AND substr(id,1,length(?2)+7)='class:'||?3||':') `).bind(id,id)
  ]);return json({ok:true});
 }
 case '/api/class-delete':return json(await removeRecord(env.DB,'class',data.id));
 case '/api/seen':await env.DB.prepare(`${ownerSQL} UPDATE updates SET seen=1 WHERE user_id=(SELECT id FROM owner) AND (id=?2) `).bind(data.id).run();return json({ok:true});
 case '/api/subscribe':{
  if(!validPush(data))return json({error:'Unsupported push subscription'},400);
  const id=await digest(data.endpoint),existing=await root.DB.prepare('SELECT user_id,device_id FROM subscriptions WHERE id=?').bind(id).first();
  if(existing&&(existing.user_id!==user.id||(existing.device_id&&existing.device_id!==user.device_id)))return json({error:'This browser is registered to another session. Disable its old subscription before enabling notifications.'},409);
  await env.DB.prepare(`${ownerSQL} INSERT INTO subscriptions (user_id,id,value,device_id) VALUES ((SELECT id FROM owner),?2,?3,?4) ON CONFLICT(user_id,id) DO UPDATE SET value=excluded.value,device_id=excluded.device_id`).bind(id,JSON.stringify(data),user.device_id).run();return json({ok:true});
 }
 case '/api/unsubscribe':await env.DB.prepare(`${ownerSQL} DELETE FROM subscriptions WHERE user_id=(SELECT id FROM owner) AND id=?2 AND device_id=?3`).bind(await digest(String(data.endpoint)),user.device_id).run();return json({ok:true});
 case '/api/push-status':
 case '/api/push-test':
 case '/api/deliveries':{
  if(typeof data.endpoint!=='string'||!data.endpoint||data.endpoint.length>2048)return json({error:'Check notification setup on this device first.'},400);
  const id=await digest(data.endpoint),sub=await env.DB.prepare(`${ownerSQL} SELECT id FROM (SELECT * FROM subscriptions WHERE user_id=(SELECT id FROM owner)) subscriptions WHERE id=?2 AND device_id=?3`).bind(id,user.device_id).first();
  if(url.pathname==='/api/push-status')return json({subscribed:!!sub});
  if(!sub)return json({error:'Enable notifications on this device first.'},400);
  if(url.pathname==='/api/deliveries')return json((await env.DB.prepare(`${ownerSQL} SELECT id,sent,attempts,error,due FROM (SELECT * FROM deliveries WHERE user_id=(SELECT id FROM owner)) deliveries WHERE subscription_id=?2 ORDER BY due DESC LIMIT 10`).bind(id).all()).results);
  await queue(env,`test:${crypto.randomUUID()}`,{title:'Your planner is working',body:'This test was sent only to this device by your cloud reminder service.',url:'/#settings/notifications'},new Date(Date.now()+(data.delayed?120000:0)).toISOString(),id);
  await schedule(root,user.id,'deliver',id,Date.now()+(data.delayed?120000:0));
  return json({ok:true,message:data.delayed?'Test queued for this device in two minutes. Close the app, then check this device.':'Test request processed for this device. Check its notifications and delivery details.'});
 }
 case '/api/connect':return withUserLease(root,user,async scoped=>{const courses=await connect(scoped,data.token);await clearAttendance(scoped);await root.DB.prepare('UPDATE users SET generation=generation+1 WHERE id=? AND generation=?').bind(user.id,user.generation).run();return json({ok:true,courses});});
 case '/api/sync':{
  await authLimit(root,'manual-sync:'+user.id,8);
  for(const course of (await currentCourses(env.DB)).filter(c=>c.id!=null))await schedule(root,user.id,'sync',String(course.id));
  return json({ok:true,message:'Course checks queued.'});
 }
 case '/api/disconnect':{
  await root.DB.prepare('UPDATE users SET generation=generation+1 WHERE id=?').bind(user.id).run();
  const fresh=await root.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first(),scoped=userEnvironment(root,fresh);
  await clearAttendance(scoped);
  await scoped.DB.prepare(`${ownerSQL} DELETE FROM user_settings WHERE user_id=(SELECT id FROM owner) AND key IN ('moodle_token','connection','courses')`).run();
  await root.DB.prepare("DELETE FROM jobs WHERE user_id=? AND kind IN ('sync','attendance')").bind(user.id).run();
  return json({ok:true});
 }
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
 async scheduled(event,env,ctx){ctx.waitUntil(dispatch(env));},
 async queue(batch,env){await consume(batch,env,executeJob);}
};

async function clearAttendance(env){
 await setAttendanceEnabled(env,false);
 await env.DB.prepare(`${ownerSQL} DELETE FROM user_settings WHERE user_id=(SELECT id FROM owner) AND key IN ('attendance_cookie','attendance_connection','attendance_mobile')`).run();
 await env.database.prepare('DELETE FROM attendance_pairings WHERE user_id=?').bind(env.userId).run();
}
