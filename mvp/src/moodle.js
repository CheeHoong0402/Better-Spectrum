import {digest,seal,unseal} from './security.js';
export async function setting(db,k,v){if(v===undefined)return (await db.prepare('SELECT value FROM settings WHERE key=?').bind(k).first())?.value;await db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').bind(k,String(v)).run();}
export async function call(token,fn,args={}){
 const p=new URLSearchParams({wstoken:token,wsfunction:fn,moodlewsrestformat:'json',...args});
 const r=await fetch('https://spectrum.um.edu.my/webservice/rest/server.php',{method:'POST',body:p,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('SPeCTRUM is temporarily unavailable.');
 let data;try{data=await r.json();}catch{throw new Error('SPeCTRUM did not return API data.');}
 if(data.exception)throw new Error(['invalidtoken','accessexception','webservice_access_exception'].includes(data.errorcode)?'SPeCTRUM access expired or this function is not permitted. Reconnect or check mobile access.':`SPeCTRUM could not complete ${fn}.`);
 return data;
}
const coursePalette=['#4263b5','#a84b26','#416f3d','#147870','#6c4cbf','#b7446a','#a65c16'];
export function presentCourses(rows,previous=[]){
 return rows.map(c=>{
  const saved=previous.find(p=>c.id!=null&&p.id!=null?String(p.id)===String(c.id):p.code===c.code);
  const slot=[...String(c.id??c.code)].reduce((n,char)=>(n*31+char.charCodeAt(0))>>>0,0)%coursePalette.length;
  return {...c,code:saved?.code||c.code||c.shortname,
   color:saved?.color||(c.color&&c.color!=='#4263b5'?c.color:coursePalette[slot])};
 });
}
export async function currentCourses(db){
 const catalog=JSON.parse(await setting(db,'course_catalog')||'[]'),configured=await setting(db,'courses');
 const courses=presentCourses(configured?JSON.parse(configured):catalog,catalog);
 return [...courses,...presentCourses(catalog.filter(c=>!courses.some(p=>p.code===c.code)))];
}
export async function connect(env,token){
 if(typeof token!=='string'||token.length<10||token.length>500)throw new Error('Enter a valid Moodle mobile access token.');
 const info=await call(token,'core_webservice_get_site_info');
 const courses=await call(token,'core_enrol_get_users_courses',{userid:info.userid});
 await setting(env.DB,'moodle_token',await seal(token,env.AUTH_SECRET));
 const previous=await currentCourses(env.DB);
 await setting(env.DB,'courses',JSON.stringify(presentCourses(courses.map(c=>({id:c.id,code:c.shortname,name:c.fullname})),previous)));
 await setting(env.DB,'connection','Connected · waiting for first course check');
 return courses.length;
}
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,700);
export async function syncCourse(env,index){
 const encrypted=await setting(env.DB,'moodle_token');if(!encrypted)return;
 const token=await unseal(encrypted,env.AUTH_SECRET);
 const courses=(await currentCourses(env.DB)).filter(c=>c.id!=null);if(!courses.length)return;
 const c=courses[index%courses.length];
 const sections=await call(token,'core_course_get_contents',{courseid:c.id});
 const base=await setting(env.DB,`baseline:${c.id}`);const events=[],writes=[];let forumChecks=0;
 const snapshots=new Map((await env.DB.prepare('SELECT id,hash FROM snapshots').all()).results.map(s=>[s.id,s.hash]));
 async function watch(id,value,title,kind,url){
  const hash=await digest(JSON.stringify(value));const old=snapshots.get(id);
  if(base&&(!old||old!==hash))events.push({id:`${id}-${hash}`,course:c.code,title:old?`Updated: ${title}`:`New: ${title}`,body:kind==='announcement'?clean(value.message||value.description||value.name||value.title):'Open SPeCTRUM to view the latest version.',kind,url});
  writes.push(env.DB.prepare('INSERT OR REPLACE INTO snapshots VALUES (?,?)').bind(id,hash));
 }
 for(const section of sections){
  for(const m of section.modules||[]){
   if(['assign','attendance','quiz'].includes(m.modname))continue;
   await watch(`module:${m.id}`,{name:m.name,description:m.description,files:(m.contents||[]).map(f=>({name:f.filename,modified:f.timemodified,size:f.filesize,url:f.fileurl}))},m.name,m.modname==='forum'||m.modname==='label'?'announcement':'material',m.url||`https://spectrum.um.edu.my/course/view.php?id=${c.id}`);
   if(m.modname==='forum'&&forumChecks++<3){
    try{const forum=await call(token,'mod_forum_get_forum_discussions',{forumid:m.instance,perpage:10});for(const post of forum.discussions||[])await watch(`post:${post.discussion}`,{title:post.name,message:post.message,modified:post.timemodified},post.name,'announcement',`https://spectrum.um.edu.my/mod/forum/discuss.php?d=${post.discussion}`);}catch{await setting(env.DB,`partial:${c.id}`,'Forum posts unavailable; course content is monitored.');}
   }
  }
 }
 const assignments=await call(token,'mod_assign_get_assignments',{'courseids[0]':c.id});let statusChecks=0;
 for(const course of assignments.courses||[])for(const a of course.assignments||[]){
  if(!a.duedate)continue;
  const id=`assign-${a.cmid}`, due=new Date(a.duedate*1000).toISOString(),url=`https://spectrum.um.edu.my/mod/assign/view.php?id=${a.cmid}`;
  const old=await env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(id).first();let status='unknown';
  try{if(statusChecks++>=8)throw new Error('status limit');const s=await call(token,'mod_assign_get_submission_status',{assignid:a.id});status=s.lastattempt?.submission?.status==='submitted'?'submitted':s.lastattempt?.submission?.status==='draft'?'draft':'pending';}catch{await setting(env.DB,`partial:${c.id}`,'Submission status unavailable for some assignments.');}
  await env.DB.prepare('INSERT INTO tasks (id,course,title,due,status,source,url) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET course=excluded.course,title=excluded.title,due=excluded.due,status=excluded.status,url=excluded.url').bind(id,c.code,clean(a.name),due,status,'SPeCTRUM',url).run();
  if(base&&(!old||Date.parse(old.due)!==Date.parse(due)))events.push({id:`deadline:${id}:${due}`,course:c.code,title:old?'Assignment deadline changed':`New assignment: ${clean(a.name)}`,body:`Due ${new Date(due).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT`,kind:'deadline',url});
 }
 for(let i=0;i<writes.length;i+=80)await env.DB.batch(writes.slice(i,i+80));
 for(const e of events){await env.DB.prepare('INSERT OR IGNORE INTO updates (id,course,title,body,url,kind,changed) VALUES (?,?,?,?,?,?,?)').bind(e.id,e.course,e.title,e.body,e.url,e.kind,new Date().toISOString()).run();}
 await setting(env.DB,`baseline:${c.id}`,'1');await setting(env.DB,`synced:${c.id}`,new Date().toISOString());await setting(env.DB,'last_sync',new Date().toISOString());await setting(env.DB,'connection','Connected');return events;
}
