import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {tick} from '../src/worker.js';
function adapter(sqlite){return {prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){return sqlite.prepare(sql).run(...args);}};},async batch(stmts){return Promise.all(stmts.map(s=>s.run()));}};}
test('scheduler retries per device and suppresses duplicate completed deliveries',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(await readFile(new URL('../schema.sql',import.meta.url),'utf8'));const DB=adapter(sqlite);
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
 const p256dh=Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url');
 const env={DB,AUTH_SECRET:'test',VAPID_SUBJECT:'https://planner.example',VAPID_PUBLIC_KEY:p256dh,VAPID_PRIVATE_KEY:priv.d};
 const sub={endpoint:'https://fcm.googleapis.com/fake-test-only',keys:{p256dh,auth:randomBytes(16).toString('base64url')}};
 await DB.prepare('INSERT INTO subscriptions VALUES (?,?)').bind('device',JSON.stringify(sub)).run();
 const now=Date.now();await DB.prepare('INSERT INTO tasks (id,course,title,due,reminder_minutes) VALUES (?,?,?,?,?)').bind('test-task','COURSE-1','Test reminder',new Date(now+3600000).toISOString(),120).run();
 const originalFetch=globalThis.fetch;let sends=0;
 globalThis.fetch=async(url,options)=>{assert.equal(url,sub.endpoint);assert.equal(options.headers['content-encoding'],'aes128gcm');assert.ok(options.body.byteLength>100);sends++;return new Response('',{status:sends===1?503:201});};
 try{
  await tick(env,now);let rows=(await DB.prepare('SELECT * FROM deliveries').all()).results;assert.equal(rows.length,1);assert.equal(rows[0].attempts,1);assert.equal(rows[0].sent,null);
  await tick(env,now+60000);rows=(await DB.prepare('SELECT * FROM deliveries').all()).results;assert.ok(rows[0].sent);assert.equal(sends,2);
  await tick(env,now+120000);assert.equal(sends,2);assert.equal((await DB.prepare('SELECT * FROM deliveries').all()).results.length,1);
 }finally{globalThis.fetch=originalFetch;sqlite.close();}
});
