import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,testCookie} from '../test-support/db.js';
import {userEnvironment} from '../src/tenant.js';
import {setting,connect} from '../src/moodle.js';
import {sealCredential,unsealCredential,digest} from '../src/security.js';
import {previewSemester,applySemester} from '../src/semester.js';
import {pairAttendance} from '../src/attendance.js';
import {manageUser} from '../scripts/manage-user.mjs';
import worker,{reminders} from '../src/worker.js';
const term=()=>({id:'same-term',revision:0,name:'Private term',start:'2030-01-07',end:'2030-01-20',week1:'2030-01-07',excludedDates:[],series:[{id:'same-series',course:'SAME101',name:'Same course',kind:'Lecture',weekday:1,start:'09:00',end:'10:00',room:'Room',occ:'1',weeks:[]}]});

async function fixture(t){
 const {raw:DB,sqlite}=database({strict:true});sqlite.exec("DELETE FROM subscriptions;INSERT INTO users (id,auth_subject,email) VALUES ('user-b','subject-b','b@example.com')");
 const env={DB,DATA_ENCRYPTION_KEY:'test-data-secret'},a=userEnvironment(env,{id:'test-user',generation:0}),b=userEnvironment(env,{id:'user-b',generation:0});
 const cookies={a:await testCookie(DB),b:await testCookie(DB,'user-b','device-b')};
 const request=(who,path,data,extra={})=>worker.fetch(new Request('https://planner.test/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://planner.test','Content-Type':'application/json',Cookie:cookies[who],'X-Planner-User':who==='a'?'test-user':'user-b',...extra},body:data===undefined?undefined:JSON.stringify(data)}),env);
 t.after(()=>sqlite.close());return {DB,sqlite,env,a,b,cookies,request};
}
test('identical imported and semester identifiers stay private across state, revisions, deletion, recovery and reminders',async t=>{
 const f=await fixture(t);
 for(const [ctx,title,allowed] of [[f.a,'Private A',1],[f.b,'Private B',0]]){
  f.sqlite.prepare('INSERT INTO tasks (user_id,id,course,title,due,source) VALUES (?,?,?,?,?,?)').run(ctx.userId,'assign-123','SAME101',title,'2030-01-01T02:00:00.000Z','SPeCTRUM');
  f.sqlite.prepare('INSERT INTO content_scopes (user_id,id,course,allowed) VALUES (?,?,?,?)').run(ctx.userId,'module:123','SAME101',allowed);
  await setting(ctx.DB,'connection',title);const preview=await previewSemester(ctx.DB,term());await applySemester(ctx.DB,preview.definition,preview.token);
  f.sqlite.prepare('INSERT INTO subscriptions (user_id,id,value,device_id) VALUES (?,?,?,?)').run(ctx.userId,ctx.userId,'{}','device');
 }
 const stateA=await(await f.request('a','state')).json(),stateB=await(await f.request('b','state')).json();
 assert.equal(stateA.tasks[0].title,'Private A');assert.equal(stateB.tasks.length,0);assert.equal(stateB.connection,'Private B');assert.equal(stateA.classes[0].id,stateB.classes[0].id);
 await f.request('a','task-delete',{id:'assign-123'});assert.equal((await(await f.request('a','state')).json()).tasks.length,0);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM user_settings WHERE user_id='user-b' AND key LIKE 'removed:%'").get().n,0);
 await f.request('a','restore',{type:'task',id:'assign-123'});
 await reminders(f.a,Date.parse('2030-01-01T01:00:00Z'));await reminders(f.b,Date.parse('2030-01-01T01:00:00Z'));
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries WHERE user_id='test-user'").get().n,1);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM deliveries WHERE user_id='user-b'").get().n,0);
 const preview=await previewSemester(f.a.DB,{...term(),revision:1});await assert.rejects(applySemester(f.b.DB,{...term(),revision:1},preview.token),/changed/);
});
test('forged IDs and account headers cannot read or alter another planner or its devices',async t=>{
 const f=await fixture(t);f.sqlite.exec("INSERT INTO tasks (user_id,id,course,title,due) VALUES ('user-b','only-b','TEST','Private B','2030-01-01')");
 for(const [path,data] of [['task-update',{id:'only-b',course:'TEST',title:'Attack',due:'2030-02-01T00:00:00Z',reminder_minutes:120}],['task-delete',{id:'only-b'}],['task-status',{id:'only-b',done:true}],['restore',{type:'task',id:'only-b'}]])await f.request('a',path,{...data,user_id:'user-b'});
 assert.equal(f.sqlite.prepare("SELECT title FROM tasks WHERE user_id='user-b'").get().title,'Private B');
 assert.equal((await f.request('a','state',undefined,{'X-Planner-User':'user-b'})).status,409);
 assert.equal((await f.request('a','state',undefined,{'X-Planner-User':''})).status,409);
 const endpoint='https://fcm.googleapis.com/device-b',subscriptionId=await digest(endpoint);f.sqlite.prepare('INSERT INTO subscriptions (user_id,id,value,device_id) VALUES (?,?,?,?)').run('user-b',subscriptionId,'{}','device-b');
 assert.equal((await(await f.request('a','push-status',{endpoint})).json()).subscribed,false);
 assert.equal((await f.request('a','deliveries',{endpoint})).status,400);
 assert.throws(()=>f.sqlite.prepare('INSERT INTO deliveries (user_id,id,subscription_id,payload,due) VALUES (?,?,?,?,?)').run('test-user','foreign',subscriptionId,'{}','2030'),/FOREIGN KEY/);
});
test('credentials and helper codes are bound to one student, and changed generations fence stale writes',async t=>{
 const f=await fixture(t),encrypted=await sealCredential(f.a,'moodle_token','token-a');
 await setting(f.a.DB,'moodle_token',encrypted);await assert.rejects(unsealCredential(f.b,'moodle_token',encrypted));
 const pair=await pairAttendance(f.a);const row=f.sqlite.prepare('SELECT * FROM attendance_pairings').get();assert.equal(row.user_id,'test-user');assert.notEqual(row.id,pair.code);
 f.sqlite.exec("UPDATE users SET generation=1 WHERE id='test-user'");
 await assert.rejects(setting(f.a.DB,'connection','Stale write'),/NOT NULL/);
 const fresh=userEnvironment(f.env,{id:'test-user',generation:1});assert.equal(await setting(fresh.DB,'connection'),undefined);
});
test('SPeCTRUM identity pinning rejects another student and duplicate ownership',async t=>{
 const f=await fixture(t),original=globalThis.fetch;let id=42;
 globalThis.fetch=async(url,options)=>Response.json(options.body.get('wsfunction')==='core_webservice_get_site_info'?{userid:id}:[]);
 t.after(()=>globalThis.fetch=original);
 await connect(f.a,'a-valid-token');await assert.rejects(connect(f.b,'another-valid-token'),/already linked/);
 id=99;await assert.rejects(connect(f.a,'another-valid-token'),/does not match/);
 assert.equal(await unsealCredential(f.a,'moodle_token',await setting(f.a.DB,'moodle_token')),'a-valid-token');
});
test('operator removal deletes one planner and revokes its devices without affecting another user',async t=>{
 const f=await fixture(t);for(const id of ['test-user','user-b'])f.sqlite.prepare('INSERT INTO tasks (user_id,id,course,title,due) VALUES (?,?,?,?,?)').run(id,'same','TEST','Private','2030-01-01');
 for(const ctx of [f.a,f.b]){const preview=await previewSemester(ctx.DB,term());await applySemester(ctx.DB,preview.definition,preview.token);}
 await manageUser(f.DB,'test-user','remove');assert.equal(f.sqlite.prepare("SELECT count(*) n FROM tasks WHERE user_id='test-user'").get().n,0);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM tasks WHERE user_id='user-b'").get().n,1);assert.equal((await f.request('a','state')).status,401);assert.equal((await f.request('b','state')).status,200);
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM class_occurrences WHERE user_id='test-user'").get().n,0);assert.equal(f.sqlite.prepare("SELECT count(*) n FROM class_occurrences WHERE user_id='user-b'").get().n,2);
});
