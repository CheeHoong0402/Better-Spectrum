import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import {database,testCookie} from '../test-support/db.js';
import {session} from '../src/security.js';

function fixture(t){
 const {raw:DB,sqlite}=database(),previous=globalThis.fetch;
 const env={DB,DATA_ENCRYPTION_KEY:'test-data-secret',SUPABASE_URL:'https://test-project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable'};
 let subject='test-subject',confirmed=true,available=true,calls=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.match(String(url),/^https:\/\/test-project.supabase.co\/auth\/v1\/(otp|verify)$/);assert.equal(options.headers.apikey,'test-publishable');if(!available)return Response.json({}, {status:503});return Response.json(String(url).endsWith('verify')?{user:{id:subject,email_confirmed_at:confirmed?'2026-11-10':null}}:{});};
 t.after(()=>{sqlite.close();globalThis.fetch=previous;});
 const request=(path,data,cookie='',extra={})=>worker.fetch(new Request('https://planner.test/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://planner.test','Content-Type':'application/json',Cookie:cookie,'X-Planner-User':'test-user',...extra},body:data===undefined?undefined:JSON.stringify(data)}),env);
 const start=async(email='student@example.com')=>{const response=await request('auth/start',{email});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 return {DB,sqlite,env,request,start,setSubject:v=>subject=v,setConfirmed:v=>confirmed=v,offline:()=>available=false,calls:()=>calls};
}
test('invited email verification issues an opaque revocable session and consumes its challenge once',async t=>{
 const f=fixture(t),flow=await f.start();
 const response=await f.request('auth/verify',{code:'12345678'},flow);assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie');assert.match(cookie,/__Host-sm_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict/);
 const user=await session(new Request('https://planner.test',{headers:{Cookie:cookie}}),f.DB);assert.equal(user.id,'test-user');
 assert.equal((await f.request('state',undefined,cookie)).status,200);
 assert.equal((await f.request('auth/verify',{code:'12345678'},flow)).status,401);
 assert.equal((await f.request('logout',{},cookie)).status,200);
 assert.equal((await f.request('state',undefined,cookie)).status,401);
});
test('unknown invitations, mismatched subjects, missing confirmation, stale flows and old cookies fail closed',async t=>{
 const f=fixture(t),unknown=await f.start('unknown@example.com');assert.equal(f.calls(),0);
 assert.equal((await f.request('auth/verify',{code:'12345678'},unknown)).status,401);
 const flow=await f.start();f.setSubject('other');assert.equal((await f.request('auth/verify',{code:'12345678'},flow)).status,403);
 f.setSubject('test-subject');f.setConfirmed(false);assert.equal((await f.request('auth/verify',{code:'12345678'},flow)).status,403);
 f.sqlite.exec('UPDATE auth_attempts SET expires=0');assert.equal((await f.request('auth/verify',{code:'12345678'},flow)).status,401);
 for(const path of ['login','spectrum-login-start','spectrum-login-finish'])assert.equal((await f.request(path,{password:'old-password'})).status,401);
 assert.equal((await f.request('state',undefined,'sm_session=9999999999999.old-signature')).status,401);
});
test('origin, rate limits, account changes, expiry, suspension and maintenance protect private routes',async t=>{
 const f=fixture(t),cookie=await testCookie(f.DB);
 assert.equal((await f.request('tasks',{},cookie,{Origin:'https://other.example'})).status,403);
 assert.equal((await f.request('tasks',{},cookie,{'X-Planner-User':'other'})).status,409);
 f.sqlite.exec("UPDATE sessions SET expires=0");assert.equal((await f.request('state',undefined,cookie)).status,401);
 const next=await testCookie(f.DB);f.sqlite.exec("UPDATE users SET status='suspended'");assert.equal((await f.request('state',undefined,next)).status,401);
 for(let i=0;i<8;i++)await f.request('auth/start',{email:'unknown@example.com'});
 assert.equal((await f.request('auth/start',{email:'unknown@example.com'})).status,429);
 f.env.MAINTENANCE='1';assert.equal((await f.request('state',undefined,next)).status,503);
});
test('simultaneous verification admits one session; provider failures do not create sessions',async t=>{
 const f=fixture(t),flow=await f.start();
 const replies=await Promise.all([f.request('auth/verify',{code:'12345678'},flow),f.request('auth/verify',{code:'12345678'},flow)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM sessions').get().n,1);
 f.offline();assert.equal((await f.request('auth/start',{email:'student@example.com'})).status,503);
});
