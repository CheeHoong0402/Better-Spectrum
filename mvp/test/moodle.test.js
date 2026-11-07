import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../test-support/db.js';
import {seal,sign} from '../src/security.js';
import {setting,syncCourse} from '../src/moodle.js';
import worker,{tick} from '../src/worker.js';

const assignment=id=>({id,cmid:id+100,name:`Assignment ${id}`,duedate:1900000000+id});
async function fixture(t,assignments=[assignment(1)],modules=[]){
 const {DB,sqlite}=database(),env={DB,AUTH_SECRET:'test-only'};
 await setting(DB,'moodle_token',await seal('test-token',env.AUTH_SECRET));
 await setting(DB,'courses',JSON.stringify([{id:1,code:'TEST101'}]));
 const data={assignments,modules,assignmentWarnings:[],courseCalls:[],statuses:new Map(),forumError:false,assignmentError:false,groupError:false,groups:[{id:10,name:'GROUP 10',idnumber:'2026@2027@1@10'}],sections:null,posts:new Map(),statusCalls:[],forumCalls:[]};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://spectrum.um.edu.my/webservice/rest/server.php');
  const p=options.body;assert.equal(p.get('wstoken'),'test-token');
  switch(p.get('wsfunction')){
   case 'core_course_get_contents':data.courseCalls.push(Number(p.get('courseid')));return Response.json(data.sections||[{id:1,name:'General',modules:[...data.modules,...data.assignments.map(a=>({id:a.cmid,name:a.name,modname:'assign'}))]}]);
   case 'core_group_get_course_user_groups':return Response.json(data.groupError?{exception:'moodle_exception',errorcode:'accessexception'}:{groups:data.groups});
   case 'mod_assign_get_assignments':return Response.json(data.assignmentError?{exception:'moodle_exception',errorcode:'invalidtoken'}:{courses:[{assignments:data.assignments}],warnings:data.assignmentWarnings});
   case 'mod_assign_get_submission_status':{
    const id=Number(p.get('assignid'));data.statusCalls.push(id);
    return Response.json(data.statuses.get(id)||{lastattempt:{submission:{status:'new'}}});
   }
   case 'mod_forum_get_forum_discussions':{
    const id=Number(p.get('forumid'));data.forumCalls.push(id);
    return Response.json(data.forumError?{exception:'moodle_exception',errorcode:'accessexception'}:{discussions:data.posts.get(id)||[]});
   }
   default:throw new Error('Unexpected API call');
  }
 };
 t.after(()=>{globalThis.fetch=originalFetch;sqlite.close();});
 return {DB,sqlite,env,data};
}

test('bounded checks rotate through every assignment and forum without first-import alerts',async t=>{
 const assignments=Array.from({length:13},(_,i)=>assignment(i+1));
 const forums=Array.from({length:4},(_,i)=>({id:i+1,instance:i+10,modname:'forum',name:`Forum ${i}`}));
 const {env,data,sqlite}=await fixture(t,assignments,forums);
 for(const f of forums)data.posts.set(f.instance,[{discussion:f.id,name:'Existing post',message:'Existing content',timemodified:1}]);
 assert.deepEqual(await syncCourse(env,0),[]);
 assert.equal(data.statusCalls.length,8);assert.equal(data.forumCalls.length,3);
 data.statusCalls=[];data.forumCalls=[];
 assert.deepEqual(await syncCourse(env,0),[]);
 assert.deepEqual(new Set(data.statusCalls),new Set([9,10,11,12,13,1,2,3]));
 assert.deepEqual(new Set(data.forumCalls),new Set([13,10,11]));
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM tasks WHERE status='unknown'").get().n,0);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM updates').get().n,0);
 assert.match(sqlite.prepare("SELECT value FROM settings WHERE key='partial:1'").get().value,/TEST101:.*rotate/);
 data.posts.get(10)[0].message='Changed content';
 const events=await syncCourse(env,0);assert.equal(events.length,1);assert.equal(events[0].kind,'announcement');
 assert.deepEqual(await syncCourse(env,0),[]);
});

test('failed submission checks retain confirmed results and aggregate warnings until recovery',async t=>{
 const {env,data,sqlite,DB}=await fixture(t,[assignment(1),assignment(2),assignment(3)],[{id:1,instance:10,modname:'forum',name:'Announcements'}]);
 data.statuses.set(1,{lastattempt:{submission:{status:'submitted'}}});
 data.statuses.set(2,{lastattempt:{submission:{status:'draft'}}});
 await syncCourse(env,0);
 data.forumError=true;
 for(const id of [1,2,3])data.statuses.set(id,{exception:'moodle_exception',errorcode:'accessexception'});
 await syncCourse(env,0);
 assert.deepEqual(sqlite.prepare('SELECT status FROM tasks ORDER BY id').all().map(r=>r.status),['submitted','draft','pending']);
 const warning=await setting(DB,'partial:1');assert.match(warning,/TEST101:.*Forum posts unavailable/);assert.match(warning,/Submission status unavailable/);
 data.forumError=false;data.statuses.clear();
 await syncCourse(env,0);
 assert.equal(await setting(DB,'partial:1'),undefined);
 assert.equal(sqlite.prepare("SELECT status FROM tasks WHERE id='assign-101'").get().status,'pending');
});

test('assignment access warnings outside the allowed scope do not mark a course as partial',async t=>{
 const {env,data,DB,sqlite}=await fixture(t);
 data.sections=[{id:1,name:'General',modules:[{id:101,name:'My assignment',modname:'assign'},{id:102,name:'Hidden assignment',modname:'assign',uservisible:false}]},{id:2,name:'OCC 4',modules:[{id:103,name:'Other group assignment',modname:'assign'}]}];
 data.assignmentWarnings=[102,103,999].map(itemid=>({item:'module',itemid,warningcode:'1',message:'No access rights in module context'}));
 await setting(DB,'partial:1','Old generic warning');
 await syncCourse(env,0);
 assert.equal(await setting(DB,'partial:1'),undefined);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
 data.assignmentWarnings.push({item:'module',itemid:101,warningcode:'1',message:'No access rights in module context'});
 await syncCourse(env,0);
 assert.match(await setting(DB,'partial:1'),/Some assignments are unavailable/);
 data.assignmentWarnings=[{item:'course',itemid:1,warningcode:'2',message:'User is not enrolled'}];
 await syncCourse(env,0);
 assert.match(await setting(DB,'partial:1'),/Some assignments are unavailable/);
 data.assignmentWarnings=[{item:'module',itemid:999,warningcode:'unexpected',message:'Unknown failure'}];
 await syncCourse(env,0);
 assert.match(await setting(DB,'partial:1'),/Some assignments are unavailable/);
});

test('normal submission batching keeps earlier statuses without a partial-sync warning',async t=>{
 const {env,DB,sqlite}=await fixture(t,Array.from({length:9},(_,i)=>assignment(i+1)));
 await syncCourse(env,0);
 assert.equal(await setting(DB,'partial:1'),undefined);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM tasks WHERE status='unknown'").get().n,1);
 await syncCourse(env,0);
 assert.equal(await setting(DB,'partial:1'),undefined);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM tasks WHERE status='unknown'").get().n,0);
});

test('manual course checks rotate, including after a failed check',async t=>{
 const {env,DB,data}=await fixture(t,[]);
 await setting(DB,'courses',JSON.stringify([{id:1,code:'TEST101'},{id:2,code:'TEST102'}]));
 const expiry=String(Date.now()+60000),cookie=`sm_session=${expiry}.${await sign(expiry,env.AUTH_SECRET)}`;
 const check=()=>worker.fetch(new Request('https://test.example/api/sync',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json',Cookie:cookie},body:'{}'}),{...env,APP_PASSWORD:'test'});
 assert.equal((await check()).status,200);
 data.groupError=true;
 assert.equal((await check()).status,500);
 data.groupError=false;
 assert.equal((await check()).status,200);
 assert.equal((await check()).status,200);
 assert.deepEqual(data.courseCalls,[1,2,1,2]);
});

test('incomplete submission responses remain unverified and team drafts remain unfinished',async t=>{
 const {env,data,sqlite}=await fixture(t,[assignment(1),{...assignment(2),teamsubmission:1},assignment(3)]);
 data.statuses.set(1,{warnings:[{warningcode:'noaccess'}]});
 data.statuses.set(2,{lastattempt:{submission:{status:'submitted'},teamsubmission:{status:'draft'}}});
 data.statuses.set(3,{lastattempt:{submission:{status:'unexpected'}}});
 await syncCourse(env,0);
 assert.deepEqual(sqlite.prepare('SELECT status FROM tasks ORDER BY id').all().map(r=>r.status),['unknown','draft','unknown']);
 data.statuses.set(2,{lastattempt:{teamsubmission:{status:'submitted'}}});
 await syncCourse(env,0);assert.equal(sqlite.prepare("SELECT status FROM tasks WHERE id='assign-102'").get().status,'submitted');
});

test('confirmed submissions and changed deadlines remove only their unsent reminders',async t=>{
 const {env,data,sqlite}=await fixture(t,[assignment(1),assignment(2)]);
 await syncCourse(env,0);
 for(const [id,sent] of [['task:assign-101:old:120:device',null],['task:assign-102:old:120:device',null],['task:assign-101:sent:120:device','2026-11-01T00:00:00Z'],['task:assign-1010:old:120:device',null]])sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES (?,?,?,?,?)').run(id,'device','{}','2026-11-02T00:00:00Z',sent);
 data.statuses.set(1,{lastattempt:{submission:{status:'submitted'}}});data.assignments[1].duedate+=3600;
 const events=await syncCourse(env,0);
 assert.equal(events.length,1);assert.equal(events[0].title,'Assignment deadline changed');
 assert.deepEqual(sqlite.prepare('SELECT id FROM deliveries ORDER BY id').all().map(r=>r.id),['task:assign-1010:old:120:device','task:assign-101:sent:120:device']);
 assert.deepEqual(await syncCourse(env,0),[]);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM updates').get().n,1);
});

test('expired access does not advance sync timestamps or destroy saved tasks',async t=>{
 const {env,data,sqlite,DB}=await fixture(t);
 await syncCourse(env,0);const lastSync=await setting(DB,'synced:1'),round=await setting(DB,'sync_round:1');
 data.assignmentError=true;
 await assert.rejects(()=>syncCourse(env,0),/access expired/);
 assert.equal(await setting(DB,'synced:1'),lastSync);assert.equal(await setting(DB,'sync_round:1'),round);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
});

async function state(env){
 const expiry=String(Date.now()+60000),cookie=`sm_session=${expiry}.${await sign(expiry,env.AUTH_SECRET)}`;
 const r=await worker.fetch(new Request('https://test.example/api/state',{headers:{Cookie:cookie}}),{...env,APP_PASSWORD:'test'});
 assert.equal(r.status,200);return r.json();
}

test('group filtering hides old irrelevant deadlines and updates without deleting records or unlabelled items',async t=>{
 const {env,data,sqlite}=await fixture(t,[assignment(1),assignment(2),assignment(3)]);
 data.sections=[{id:1,name:'T4',modules:[{id:101,name:'Tutorial 1',modname:'assign'}]},{id:2,name:'T6, T10, T13',modules:[{id:102,name:'Tutorial 1',modname:'assign'}]},{id:3,name:'Submission',modules:[{id:103,name:'Assignment',modname:'assign'}]}];
 for(const a of data.assignments){
  sqlite.prepare('INSERT INTO tasks (id,course,title,due,source) VALUES (?,?,?,?,?)').run(`assign-${a.cmid}`,'TEST101',a.name,new Date(a.duedate*1000).toISOString(),'SPeCTRUM');
  sqlite.prepare('INSERT INTO updates (id,course,title,body,changed) VALUES (?,?,?,?,?)').run(`deadline:assign-${a.cmid}:old`,'TEST101',a.name,'Existing update','2026-01-01');
 }
 await syncCourse(env,0);const visible=await state(env);
 assert.deepEqual(new Set(visible.tasks.map(t=>t.id)),new Set(['assign-102','assign-103']));
 assert.deepEqual(new Set(visible.updates.map(u=>u.id)),new Set(['deadline:assign-102:old','deadline:assign-103:old']));
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,3);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM updates').get().n,3);
 assert.deepEqual(data.statusCalls,[2,3]);
 data.assignments[0].duedate+=3600;data.assignments[2].duedate+=3600;
 const events=await syncCourse(env,0);assert.equal(events.length,1);assert.equal(events[0].scope,'module:103');
});

test('shared forum announcements and section edits reach Updates while other groups do not',async t=>{
 const {env,data}=await fixture(t,[],[{id:50,name:'Announcements',modname:'forum',instance:20}]);
 data.sections=[{id:1,name:'General',summary:'Original announcement',modules:data.modules},{id:2,name:'OCC 4',summary:'Other group announcement',modules:[]}];
 data.posts.set(20,[{discussion:1,name:'For everyone',message:'Original',groupid:-1},{discussion:2,name:'My group',message:'Original',groupid:10},{discussion:3,name:'Another group',message:'Original',groupid:40}]);
 assert.deepEqual(await syncCourse(env,0),[]);
 for(const p of data.posts.get(20))p.message='Updated';for(const s of data.sections)s.summary='Updated announcement';
 const events=await syncCourse(env,0);
 assert.deepEqual(new Set(events.map(e=>e.scope)),new Set(['section:1','post:1','post:2']));
 assert.equal((await state(env)).updates.length,3);
 data.sections[0].name='OCC 4';await syncCourse(env,0);
 assert.equal((await state(env)).updates.length,0);
});

test('group lookup failure preserves existing data and pauses imports with an explicit warning',async t=>{
 const {env,data,DB,sqlite}=await fixture(t);await syncCourse(env,0);
 data.groupError=true;
 await assert.rejects(()=>syncCourse(env,0),/group membership/);
 assert.match(await setting(DB,'partial:1'),/updates are paused/);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
});


test('deleting an imported deadline survives sync, stops reminders and restores current university details',async t=>{
 const {env,DB,sqlite,data}=await fixture(t);
 await syncCourse(env,0);
 const expiry=String(Date.now()+60000),cookie=`sm_session=${expiry}.${await sign(expiry,env.AUTH_SECRET)}`;
 const post=(path,body)=>worker.fetch(new Request('https://test.example/api/'+path,{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)}),{...env,APP_PASSWORD:'test'});
 const id='assign-101';
 sqlite.prepare('INSERT INTO subscriptions VALUES (?,?)').run('device','{}');
 for(const [key,sent] of [[`task:${id}:pending:device`,null],[`task:${id}:sent:device`,'sent'],['task:assign-1010:pending:device',null]])sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES (?,?,?,?,?)').run(key,'device','{}','2026-01-01',sent);
 for(let i=0;i<2;i++)assert.equal((await post('task-delete',{id})).status,200);
 let visible=await state(env);assert.equal(visible.tasks.length,0);assert.equal(visible.removed.length,1);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1,'keep the imported source record');
 assert.deepEqual(sqlite.prepare('SELECT id FROM deliveries ORDER BY id').all().map(r=>r.id),['task:assign-1010:pending:device',`task:${id}:sent:device`]);
 data.assignments[0].name='Updated university assignment';data.assignments[0].duedate+=3600;
 data.statuses.set(1,{lastattempt:{submission:{status:'draft'}}});
 await syncCourse(env,0);
 visible=await state(env);assert.equal(visible.tasks.length,0);assert.equal(visible.removed[0].item.title,'Updated university assignment');assert.equal(visible.removed[0].item.status,'draft');
 let now=data.assignments[0].duedate*1000-3600000;if(Math.floor(now/60000)%2===0)now+=60000;
 await tick(env,now);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM deliveries WHERE id LIKE 'task:assign-101:%' AND sent IS NULL").get().n,0);
 assert.equal((await post('task-status',{id,done:true})).status,400,'deletion does not permit changing university submission status');
 sqlite.prepare("UPDATE content_scopes SET allowed=0 WHERE id='module:101'").run();
 visible=await state(env);assert.equal(visible.tasks.length,0);assert.equal(visible.removed.length,0,'deleted records preserve group privacy');
 assert.equal((await post('restore',{type:'task',id})).status,403);assert.equal((await post('task-delete',{id})).status,403);
 sqlite.prepare("UPDATE content_scopes SET allowed=1 WHERE id='module:101'").run();
 for(let i=0;i<2;i++)assert.equal((await post('restore',{type:'task',id})).status,200);
 visible=await state(env);assert.equal(visible.removed.length,0);assert.equal(visible.tasks.length,1);
 assert.equal(visible.tasks[0].title,'Updated university assignment');assert.equal(visible.tasks[0].status,'draft');assert.equal(visible.tasks[0].due,new Date(data.assignments[0].duedate*1000).toISOString());
 await tick(env,now);
 assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM deliveries WHERE id LIKE 'task:assign-101:%' AND sent IS NULL").get().n,1);
 assert.equal(await setting(DB,'removed:task:'+id),undefined);
});
