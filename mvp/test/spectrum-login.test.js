import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {database} from '../test-support/db.js';
import {setting} from '../src/moodle.js';
import {seal,unseal,sign,session} from '../src/security.js';
import {plannerSessionKey} from '../src/spectrum-login.js';
import worker from '../src/worker.js';

async function fixture(t){
 const {DB,sqlite}=database(),env={DB,AUTH_SECRET:'test-secret',APP_PASSWORD:'old-passphrase',PLANNER_LOGIN:'spectrum'},oldFetch=globalThis.fetch;
 await setting(DB,'moodle_token',await seal('old-token',env.AUTH_SECRET));
 const account={id:42},requests=[];
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://spectrum.um.edu.my/webservice/rest/server.php');requests.push(options.body);
  assert.equal(options.body.get('wsfunction'),'core_webservice_get_site_info');
  return Response.json({userid:options.body.get('wstoken')==='old-token'?42:account.id});
 };
 t.after(()=>{globalThis.fetch=oldFetch;sqlite.close();});
 const request=(path,data,cookie='',origin='https://planner.example')=>worker.fetch(new Request('https://planner.example/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)}),env);
 const start=async()=>{const response=await request('spectrum-login-start',{});assert.equal(response.status,200);return {flow:await response.json(),cookie:response.headers.get('set-cookie').split(';')[0]};};
 const reply=(flow,token='a'.repeat(32),passport=new URL(flow.url).searchParams.get('passport'))=>'betterspectrumlogin://token='+Buffer.from(createHash('md5').update('https://spectrum.um.edu.my'+passport).digest('hex')+':::'+token).toString('base64');
 return {DB,sqlite,env,account,requests,request,start,reply};
}

test('SPeCTRUM-only mode rejects the old passphrase and old sessions, then verifies and pins the connected owner',async t=>{
 const f=await fixture(t),{flow,cookie}=await f.start();
 assert.equal((await f.request('login',{password:'old-passphrase'})).status,401);
 const expiry=String(Date.now()+100000),oldCookie=`sm_session=${expiry}.${await sign(expiry,f.env.AUTH_SECRET)}`;
 const rejected=await f.request('state',undefined,oldCookie);assert.equal(rejected.status,401);assert.equal((await rejected.json()).loginMethod,'spectrum');
 const response=await f.request('spectrum-login-finish',{challenge:flow.challenge,callback:f.reply(flow)},cookie);
 assert.equal(response.status,200);assert.equal(await setting(f.DB,'planner_owner'),'42');
 const cookies=response.headers.getSetCookie();assert.ok(cookies.some(c=>c.startsWith('sm_spectrum=;')&&c.includes('Max-Age=0')));
 const sessionCookie=cookies.find(c=>c.startsWith('sm_session='));assert.match(sessionCookie,/HttpOnly; Secure; SameSite=Strict/);
 assert.equal(await session(new Request('https://planner.example',{headers:{Cookie:sessionCookie}}),plannerSessionKey(f.env)),true);
 assert.equal((await f.request('state',undefined,sessionCookie)).status,200);
 assert.equal(await unseal(await setting(f.DB,'moodle_token'),f.env.AUTH_SECRET),'a'.repeat(32));
 assert.equal((await f.request('spectrum-login-finish',{challenge:flow.challenge,callback:f.reply(flow)},cookie)).status,401,'one-use reply');
 assert.ok(f.requests.every(body=>!body.has('password')),'university passwords are never collected');
});

test('wrong accounts, mismatched callbacks, missing cookies, CSRF and malformed tokens cannot open the planner',async t=>{
 const f=await fixture(t),{flow,cookie}=await f.start(),data={challenge:flow.challenge,callback:f.reply(flow)};
 f.account.id=99;assert.equal((await f.request('spectrum-login-finish',data,cookie)).status,403);
 assert.equal(await setting(f.DB,'planner_owner'),undefined);assert.equal(await unseal(await setting(f.DB,'moodle_token'),f.env.AUTH_SECRET),'old-token');
 f.account.id=42;
 for(const invalid of [{...data,challenge:'wrong'},{...data,callback:f.reply(flow,'a'.repeat(32),'wrong-passport')},{...data,callback:'https://evil.example/token'},{...data,callback:f.reply(flow,'short')}])assert.equal((await f.request('spectrum-login-finish',invalid,cookie)).status,401);
 assert.equal((await f.request('spectrum-login-finish',data)).status,401);
 assert.equal((await f.request('spectrum-login-finish',data,cookie,'https://evil.example')).status,403);
 assert.equal((await f.request('spectrum-login-finish',data,cookie+'tampered')).status,401);
 assert.equal((await f.request('spectrum-login-finish',data,cookie)).status,200);
 const next=await f.start();f.account.id=99;assert.equal((await f.request('spectrum-login-finish',{challenge:next.flow.challenge,callback:f.reply(next.flow)},next.cookie)).status,403);
});

test('expired flows, rate limits and unavailable owner verification fail closed',async t=>{
 const f=await fixture(t),{flow,cookie}=await f.start();
 const encrypted=cookie.slice(cookie.indexOf('=')+1),saved=JSON.parse(await unseal(encrypted,f.env.AUTH_SECRET));saved.expires=Date.now()-1;
 const expired='sm_spectrum='+await seal(JSON.stringify(saved),f.env.AUTH_SECRET);
 assert.equal((await f.request('spectrum-login-finish',{challenge:flow.challenge,callback:f.reply(flow)},expired)).status,401);
 globalThis.fetch=async()=>{throw new Error('University offline');};
 assert.equal((await f.request('spectrum-login-finish',{challenge:flow.challenge,callback:f.reply(flow)},cookie)).status,401);
 for(let i=0;i<14;i++)await f.request('spectrum-login-start',{});
 assert.equal((await f.request('spectrum-login-start',{})).status,429);
 assert.equal(await setting(f.DB,'planner_owner'),undefined);
});
