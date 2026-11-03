import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../test-support/db.js';
import {seal} from '../src/security.js';
import {setting,syncCourse} from '../src/moodle.js';

const assignment=id=>({id,cmid:id+100,name:`Assignment ${id}`,duedate:1900000000+id});
async function fixture(t,assignments=[assignment(1)],modules=[]){
 const {DB,sqlite}=database(),env={DB,AUTH_SECRET:'test-only'};
 await setting(DB,'moodle_token',await seal('test-token',env.AUTH_SECRET));
 await setting(DB,'courses',JSON.stringify([{id:1,code:'TEST101'}]));
 const data={assignments,modules,statuses:new Map(),forumError:false,assignmentError:false,posts:new Map(),statusCalls:[],forumCalls:[]};
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://spectrum.um.edu.my/webservice/rest/server.php');
  const p=options.body;assert.equal(p.get('wstoken'),'test-token');
  switch(p.get('wsfunction')){
   case 'core_course_get_contents':return Response.json([{modules:data.modules}]);
   case 'mod_assign_get_assignments':return Response.json(data.assignmentError?{exception:'moodle_exception',errorcode:'invalidtoken'}:{courses:[{assignments:data.assignments}]});
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
