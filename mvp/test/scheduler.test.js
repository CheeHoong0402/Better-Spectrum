import {test} from 'node:test';
import assert from 'node:assert/strict';


import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {reminders,deliver} from '../src/worker.js';
import {database,testEnvironment} from '../test-support/db.js';
import {schedule,dispatch,consume} from '../src/jobs.js';
test('scheduler retries per device and suppresses duplicate completed deliveries',async()=>{
 const {sqlite,DB}=database();
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
 const p256dh=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
 const env=testEnvironment(DB,{VAPID_SUBJECT:'https://planner.example',VAPID_PUBLIC_KEY:p256dh,VAPID_PRIVATE_KEY:priv.d});
 const sub={endpoint:'https://fcm.googleapis.com/fake-test-only',keys:{p256dh,auth:randomBytes(16).toString('base64url')}};
 await DB.prepare('UPDATE subscriptions SET value=? WHERE id=?').bind(JSON.stringify(sub),'device').run();
 const now=Date.now();await DB.prepare('INSERT INTO tasks (id,course,title,due,reminder_minutes) VALUES (?,?,?,?,?)').bind('test-task','COURSE-1','Test reminder',new Date(now+3600000).toISOString(),120).run();
 const originalFetch=globalThis.fetch;let sends=0;
 globalThis.fetch=async(url,options)=>{assert.equal(url,sub.endpoint);assert.equal(options.headers['content-encoding'],'aes128gcm');assert.ok(options.body.byteLength>100);sends++;return new Response('',{status:sends===1?503:201});};
 try{
  await reminders(env,now);await deliver(env);let rows=(await DB.prepare('SELECT * FROM deliveries').all()).results;assert.equal(rows.length,1);assert.equal(rows[0].attempts,1);assert.equal(rows[0].sent,null);
  await deliver(env);rows=(await DB.prepare('SELECT * FROM deliveries').all()).results;assert.ok(rows[0].sent);assert.equal(sends,2);
  await reminders(env,now+120000);await deliver(env);assert.equal(sends,2);assert.equal((await DB.prepare('SELECT * FROM deliveries').all()).results.length,1);
 }finally{globalThis.fetch=originalFetch;sqlite.close();}
});

test('duplicate queue messages execute once, stale jobs and suspended owners do no work',async t=>{
 const {raw:DB,sqlite}=database();t.after(()=>sqlite.close());const messages=[],env={DB,DATA_ENCRYPTION_KEY:'test',JOBS:{sendBatch:async batch=>messages.push(...batch)}};
 await schedule(env,'test-user','reminders');await dispatch(env);const body=messages[0].body;
 let count=0;const message=()=>({body,ack(){},retry(){}});
 await Promise.all([consume({messages:[message()]},env,async scoped=>{assert.equal(scoped.userId,'test-user');count++;}),consume({messages:[message()]},env,async()=>count++)]);assert.equal(count,1);
 await consume({messages:[message()]},env,async()=>count++);assert.equal(count,1);
 sqlite.exec("UPDATE jobs SET due=0;UPDATE users SET generation=1");await consume({messages:[message()]},env,async()=>count++);assert.equal(count,1);
 sqlite.exec("UPDATE jobs SET generation=1;UPDATE users SET status='suspended'");await consume({messages:[{...message(),body:{...body,generation:1}}]},env,async()=>count++);assert.equal(count,1);
});

test('expired leases fence old consumers and failed jobs are bounded and observable',async t=>{
 const {raw:DB,sqlite}=database();t.after(()=>sqlite.close());const dead=[],env={DB,DATA_ENCRYPTION_KEY:'test',DEAD_LETTER:{send:async data=>dead.push(data)}};
 await schedule(env,'test-user','sync','1',0);sqlite.exec('UPDATE jobs SET attempts=4');
 const job=sqlite.prepare('SELECT id,generation FROM jobs').get();let ack=0;
 await consume({messages:[{body:job,ack(){ack++;},retry(){}}]},env,async()=>{throw Error('secret must not appear in logs');});
 assert.equal(ack,1);assert.equal(dead.length,1);const result=sqlite.prepare('SELECT status,error FROM jobs').get();assert.equal(result.status,'failed');assert.ok(!result.error.includes('secret'));
});
test('expired university credentials pause only their owner and a new connection generation resumes work',async t=>{
 const {raw:DB,sqlite}=database();t.after(()=>sqlite.close());sqlite.exec("INSERT INTO users (id,email) VALUES ('b','b@example.com')");
 const env={DB,DATA_ENCRYPTION_KEY:'test',JOBS:{sendBatch:async()=>{}}};
 for(const [user,target] of [['test-user','1'],['test-user','2'],['b','1']])await schedule(env,user,'sync',target,0);
 const body=sqlite.prepare("SELECT id,generation FROM jobs WHERE user_id='test-user' AND target='1'").get();
 await consume({messages:[{body,ack(){},retry(){}}]},env,async()=>{throw Object.assign(new Error('Expired'),{reconnect:true});});
 assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs WHERE user_id='test-user' AND status='failed'").get().n,2);assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE user_id='b'").get().status,'pending');
 sqlite.exec("UPDATE users SET generation=generation+1 WHERE id='test-user'");await dispatch(env);assert.equal(sqlite.prepare("SELECT count(*) n FROM jobs WHERE user_id='test-user' AND status='pending'").get().n,2);
});
