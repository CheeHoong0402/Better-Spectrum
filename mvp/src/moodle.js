import {ownerSQL} from './tenant.js';
import {digest,sealCredential,unsealCredential} from './security.js';
import {courseScope,groupNumbers} from './course-scope.js';
export async function setting(db,k,v){if(v===undefined)return (await db.prepare(`${ownerSQL} SELECT value FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) user_settings WHERE key=?2`).bind(k).first())?.value;await db.prepare(`${ownerSQL} INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES ((SELECT id FROM owner),?2,?3)`).bind(k,String(v)).run();}
export async function call(token,fn,args={},headers={}){
 const p=new URLSearchParams({wstoken:token,wsfunction:fn,moodlewsrestformat:'json',...args});
 const r=await fetch('https://spectrum.um.edu.my/webservice/rest/server.php',{method:'POST',headers,body:p,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('SPeCTRUM is temporarily unavailable.');
 let data;try{data=await r.json();}catch{throw new Error('SPeCTRUM did not return API data.');}
 if(data.exception){const error=new Error(['invalidtoken','accessexception','webservice_access_exception'].includes(data.errorcode)?'SPeCTRUM access expired or this function is not permitted. Reconnect or check mobile access.':`SPeCTRUM could not complete ${fn}.`);error.reconnect=data.errorcode==='invalidtoken';throw error;}
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
 if(!Number.isSafeInteger(info.userid)||info.userid<1)throw new Error('SPeCTRUM did not identify your account.');
 const owner=await env.database.prepare('SELECT moodle_user_id FROM users WHERE id=?').bind(env.userId).first();
 if(owner.moodle_user_id!=null&&owner.moodle_user_id!==info.userid)throw new Error('SPeCTRUM account does not match this planner.');
 try{await env.database.prepare("UPDATE users SET moodle_site='https://spectrum.um.edu.my',moodle_user_id=? WHERE id=? AND (moodle_user_id IS NULL OR moodle_user_id=?)").bind(info.userid,env.userId,info.userid).run();}catch{throw new Error('SPeCTRUM account is already linked to another planner.');}
 const pinned=await env.database.prepare('SELECT moodle_user_id FROM users WHERE id=?').bind(env.userId).first();
 if(pinned.moodle_user_id!==info.userid)throw new Error('SPeCTRUM account does not match this planner.');
 const courses=await call(token,'core_enrol_get_users_courses',{userid:info.userid});
 await setting(env.DB,'moodle_token',await sealCredential(env,'moodle_token',token));
 const previous=await currentCourses(env.DB);
 await setting(env.DB,'courses',JSON.stringify(presentCourses(courses.map(c=>({id:c.id,code:c.shortname,name:c.fullname})),previous)));
 await setting(env.DB,'connection','Connected · waiting for first course check');
 return courses.length;
}
const clean=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,700);
export async function syncCourse(env,index,courseId=null){
 const encrypted=await setting(env.DB,'moodle_token');if(!encrypted)return;
 const token=await unsealCredential(env,'moodle_token',encrypted);
 const courses=(await currentCourses(env.DB)).filter(c=>c.id!=null);if(!courses.length)return;
 const c=courseId==null?courses[index%courses.length]:courses.find(c=>String(c.id)===String(courseId));if(!c)return;
 const sections=await call(token,'core_course_get_contents',{courseid:c.id});
 let membership;
 try{membership=await call(token,'core_group_get_course_user_groups',{courseid:c.id});if(!Array.isArray(membership.groups)||membership.warnings?.length)throw new Error('Incomplete group response');}
 catch{await setting(env.DB,`partial:${c.id}`,`${c.code}: Group membership unavailable; course updates are paused to avoid other groups.`);throw new Error('SPeCTRUM group membership could not be verified.');}
 const numbers=[...new Set(membership.groups.flatMap(g=>/@(\d+)$/.test(g.idnumber||'')?[Number(g.idnumber.match(/@(\d+)$/)[1])]:groupNumbers(g.name,true)))];
 if(!numbers.length)throw new Error('SPeCTRUM did not identify your OCC or tutorial group.');
 const groupIds=new Set(membership.groups.map(g=>Number(g.id)));
 const config=JSON.parse(await setting(env.DB,`course_scope:${c.id}`)||'{}');
 const scope=courseScope(sections,numbers,config),scopeReady=await setting(env.DB,`scope_baseline:${c.id}`);
 const base=await setting(env.DB,`baseline:${c.id}`),round=Number(await setting(env.DB,`sync_round:${c.id}`))||0;
 const events=[],writes=[],warnings=new Set();
 const membershipKey=JSON.stringify([...groupIds].sort((a,b)=>a-b));
 if(await setting(env.DB,`scope_membership:${c.id}`)!==membershipKey)writes.push(env.DB.prepare(`${ownerSQL} UPDATE content_scopes SET allowed=0 WHERE user_id=(SELECT id FROM owner) AND (course=?2 AND id LIKE 'post:%') `).bind(c.code));
 const nodeIds=new Set(scope.nodes.map(n=>n.id));
 for(const old of (await env.DB.prepare(`${ownerSQL} SELECT id FROM (SELECT * FROM content_scopes WHERE user_id=(SELECT id FROM owner)) content_scopes WHERE course=?2 AND allowed=1`).bind(c.code).all()).results)if(!old.id.startsWith('post:')&&!nodeIds.has(old.id))writes.push(env.DB.prepare(`${ownerSQL} UPDATE content_scopes SET allowed=0 WHERE user_id=(SELECT id FROM owner) AND (id=?2) `).bind(old.id));
 for(const node of scope.nodes)writes.push(env.DB.prepare(`${ownerSQL} INSERT INTO content_scopes (user_id,id,course,allowed) VALUES ((SELECT id FROM owner),?2,?3,?4) ON CONFLICT(user_id,id) DO UPDATE SET allowed=excluded.allowed WHERE content_scopes.allowed<>excluded.allowed`).bind(node.id,c.code,Number(node.allowed)));
 if(!scopeReady)for(const node of scope.nodes){
  const prefix=node.id+'-';
  writes.push(env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO update_scopes (user_id,update_id,scope_id) SELECT (SELECT id FROM owner),id,?2 FROM (SELECT * FROM updates WHERE user_id=(SELECT id FROM owner)) updates WHERE course=?3 AND substr(id,1,length(?4))=?5`).bind(node.id,c.code,prefix,prefix));
  if(node.id.startsWith('module:')){const deadline=`deadline:assign-${node.id.slice(7)}:`;writes.push(env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO update_scopes (user_id,update_id,scope_id) SELECT (SELECT id FROM owner),id,?2 FROM (SELECT * FROM updates WHERE user_id=(SELECT id FROM owner)) updates WHERE course=?3 AND substr(id,1,length(?4))=?5`).bind(node.id,c.code,deadline,deadline));}
 }
 const modules=scope.modules,forums=modules.filter(m=>m.modname==='forum').sort((a,b)=>a.id-b.id);
 const forumIds=new Set(Array.from({length:Math.min(3,forums.length)},(_,i)=>forums[(round*3+i)%forums.length].id));
 if(forums.length>3)warnings.add('Some forum discussions were not checked this pass; checks rotate between forums.');
 const snapshots=new Map((await env.DB.prepare(`${ownerSQL} SELECT id,hash FROM (SELECT * FROM snapshots WHERE user_id=(SELECT id FROM owner)) snapshots`).all()).results.map(s=>[s.id,s.hash]));
 async function watch(id,value,title,kind,url,baseline=base){
  const hash=await digest(JSON.stringify(value));const old=snapshots.get(id);
  if(baseline&&(!old||old!==hash))events.push({id:`${id}-${hash}`,scope:id,course:c.code,title:old?`Updated: ${title}`:`New: ${title}`,body:kind==='announcement'?clean(value.message||value.description||value.name||value.title):'Open SPeCTRUM to view the latest version.',kind,url});
  writes.push(env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO snapshots (user_id,id,hash) VALUES ((SELECT id FROM owner),?2,?3)`).bind(id,hash));
  writes.push(env.DB.prepare(`${ownerSQL} INSERT OR IGNORE INTO update_scopes (user_id,update_id,scope_id) SELECT (SELECT id FROM owner),id,?2 FROM (SELECT * FROM updates WHERE user_id=(SELECT id FROM owner)) updates WHERE course=?3 AND substr(id,1,length(?4))=?5`).bind(id,c.code,id+'-',id+'-'));
 }
 for(const s of scope.sections)if(s.summary)await watch(`section:${s.id}`,{name:s.name,description:s.summary},s.name,'announcement',`https://spectrum.um.edu.my/course/view.php?id=${c.id}#section-${s.section}`,!!(base&&scopeReady));
 for(const m of modules){
   if(['assign','attendance','quiz'].includes(m.modname))continue;
   await watch(`module:${m.id}`,{name:m.name,description:m.description,files:(m.contents||[]).map(f=>({name:f.filename,modified:f.timemodified,size:f.filesize,url:f.fileurl}))},m.name,m.modname==='forum'||m.modname==='label'?'announcement':'material',m.url||`https://spectrum.um.edu.my/course/view.php?id=${c.id}`);
   if(m.modname==='forum'&&forumIds.has(m.id)){
    try{
     const forum=await call(token,'mod_forum_get_forum_discussions',{forumid:m.instance,perpage:10});
     if(!Array.isArray(forum.discussions)||forum.warnings?.length)throw new Error('Incomplete forum response');
     const forumBase=!!(base&&await setting(env.DB,`forum_baseline:${m.id}`));
     for(const post of forum.discussions){
      const groups=groupNumbers(post.name),allowed=(!(Number(post.groupid)>0)||groupIds.has(Number(post.groupid)))&&(!groups.length||groups.some(n=>numbers.includes(n)));
      writes.push(env.DB.prepare(`${ownerSQL} INSERT INTO content_scopes (user_id,id,course,allowed,parent_id) VALUES ((SELECT id FROM owner),?2,?3,?4,?5) ON CONFLICT(user_id,id) DO UPDATE SET allowed=excluded.allowed,parent_id=excluded.parent_id WHERE content_scopes.allowed<>excluded.allowed OR content_scopes.parent_id IS NOT excluded.parent_id`).bind(`post:${post.discussion}`,c.code,Number(allowed),`module:${m.id}`));
      if(allowed)await watch(`post:${post.discussion}`,{title:post.name,message:post.message,modified:post.timemodified},post.name,'announcement',`https://spectrum.um.edu.my/mod/forum/discuss.php?d=${post.discussion}`,forumBase);
     }
     writes.push(env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES ((SELECT id FROM owner),?2,?3)`).bind(`forum_baseline:${m.id}`,'1'));
    }catch{warnings.add('Forum posts unavailable; course content is monitored.');}
   }
 }
 const response=await call(token,'mod_assign_get_assignments',{'courseids[0]':c.id});
 if(!Array.isArray(response.courses))throw new Error('SPeCTRUM did not return assignment data.');
 const allowedModules=new Set(modules.filter(m=>m.modname==='assign').map(m=>Number(m.id)));
 // Moodle also warns about restricted assignments outside the student's visible scope.
 if(response.warnings?.some(w=>!(w.item==='module'&&String(w.warningcode)==='1'&&Number(w.itemid)>0&&!allowedModules.has(Number(w.itemid)))))warnings.add('Some assignments are unavailable from SPeCTRUM.');
 const assignments=(response.courses||[]).filter(course=>course.id==null||Number(course.id)===Number(c.id)).flatMap(course=>course.assignments||[]).filter(a=>a.duedate&&allowedModules.has(Number(a.cmid))).sort((a,b)=>a.id-b.id);
 const statusIds=new Set(Array.from({length:Math.min(8,assignments.length)},(_,i)=>assignments[(round*8+i)%assignments.length].id));
 for(const a of assignments){
  const id=`assign-${a.cmid}`, due=new Date(a.duedate*1000).toISOString(),url=`https://spectrum.um.edu.my/mod/assign/view.php?id=${a.cmid}`;
  writes.push(env.DB.prepare(`${ownerSQL} INSERT OR IGNORE INTO update_scopes (user_id,update_id,scope_id) SELECT (SELECT id FROM owner),id,?2 FROM (SELECT * FROM updates WHERE user_id=(SELECT id FROM owner)) updates WHERE course=?3 AND substr(id,1,length(?4))=?5`).bind(`module:${a.cmid}`,c.code,`deadline:${id}:`,`deadline:${id}:`));
  const old=await env.DB.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?2`).bind(id).first();let status=old?.status||'unknown';
  if(statusIds.has(a.id))try{
   const s=await call(token,'mod_assign_get_submission_status',{assignid:a.id});
   const value=(a.teamsubmission?s.lastattempt?.teamsubmission:s.lastattempt?.submission)?.status;
   if(!s.lastattempt||s.warnings?.length||(value&&!['submitted','draft','new','reopened'].includes(value)))throw new Error('Unverified submission response');
   status=value==='submitted'?'submitted':value==='draft'?'draft':'pending';
  }catch{warnings.add('Submission status unavailable for some assignments; last known results are kept.');}
  const changes=[env.DB.prepare(`${ownerSQL} INSERT INTO tasks (user_id,id,course,title,due,status,source,url) VALUES ((SELECT id FROM owner),?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(user_id,id) DO UPDATE SET course=excluded.course,title=excluded.title,due=excluded.due,status=excluded.status,url=excluded.url`).bind(id,c.code,clean(a.name),due,status,'SPeCTRUM',url)];
  if(status==='submitted'||(old&&Date.parse(old.due)!==Date.parse(due)))changes.push(env.DB.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (sent IS NULL AND substr(id,1,length(?2)+6)='task:'||?3||':') `).bind(id,id));
  await env.DB.batch(changes);
  if(base&&(!old||Date.parse(old.due)!==Date.parse(due)))events.push({id:`deadline:${id}:${due}`,scope:`module:${a.cmid}`,course:c.code,title:old?'Assignment deadline changed':`New assignment: ${clean(a.name)}`,body:`Due ${new Date(due).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} MYT`,kind:'deadline',url});
 }
 for(let i=0;i<writes.length;i+=80)await env.DB.batch(writes.slice(i,i+80));
 for(const e of events)await env.DB.batch([env.DB.prepare(`${ownerSQL} INSERT OR IGNORE INTO updates (user_id,id,course,title,body,url,kind,changed) VALUES ((SELECT id FROM owner),?2,?3,?4,?5,?6,?7,?8)`).bind(e.id,e.course,e.title,e.body,e.url,e.kind,new Date().toISOString()),env.DB.prepare(`${ownerSQL} INSERT OR IGNORE INTO update_scopes (user_id,update_id,scope_id) VALUES ((SELECT id FROM owner),?2,?3)`).bind(e.id,e.scope)]);
 const checked=new Date().toISOString();
 const checks=[[`sync_round:${c.id}`,round+1],[`scope_baseline:${c.id}`,'1'],[`scope_membership:${c.id}`,membershipKey],[`baseline:${c.id}`,'1'],[`synced:${c.id}`,checked],['last_sync',checked],['connection','Connected']].map(([key,value])=>env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES ((SELECT id FROM owner),?2,?3)`).bind(key,String(value)));
 checks.push(warnings.size?env.DB.prepare(`${ownerSQL} INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES ((SELECT id FROM owner),?2,?3)`).bind(`partial:${c.id}`,`${c.code}: ${[...warnings].join(' ')}`):env.DB.prepare(`${ownerSQL} DELETE FROM user_settings WHERE user_id=(SELECT id FROM owner) AND (key=?2) `).bind(`partial:${c.id}`));
 await env.DB.batch(checks);return events;
}
