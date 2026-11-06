import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {inspectNotifications} from '../public/notifications.js';
import worker from '../src/worker.js';
import {digest,sign} from '../src/security.js';
import {database} from '../test-support/db.js';

test('device readiness requires permission, a browser subscription and a server registration',async()=>{
 const state={pushReady:true,pushKey:'configured'},sub={endpoint:'https://fcm.googleapis.com/test'},navigator={serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>sub}})}};
 let calls=0,registered=true;
 const browser={navigator,Notification:{permission:'granted'},PushManager:{},api:async(path,data)=>{calls++;assert.equal(path,'push-status');assert.equal(data.endpoint,sub.endpoint);return {subscribed:registered};}};
 assert.equal((await inspectNotifications(state,browser)).status,'enabled');registered=false;
 assert.equal((await inspectNotifications(state,browser)).status,'setup');
 navigator.serviceWorker.getRegistration=async()=>({pushManager:{getSubscription:async()=>null}});
 assert.equal((await inspectNotifications(state,browser)).status,'setup');assert.equal(calls,2);
 browser.Notification.permission='denied';assert.equal((await inspectNotifications(state,browser)).status,'blocked');assert.equal(calls,2);
 assert.equal((await inspectNotifications(state,{...browser,PushManager:undefined})).status,'unsupported');
 browser.Notification.permission='granted';assert.equal((await inspectNotifications({...state,pushReady:false},browser)).status,'unavailable');
});

test('notification controls match readiness and tests carry only the current device endpoint',async()=>{
 const source=readFileSync(new URL('../public/notifications.js',import.meta.url),'utf8').replaceAll('export ','');
 for(const ready of [false,true]){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{id,children:[],isConnected:true,append(c){this.children.push(c);},replaceChildren(){this.children=[];}});return nodes.get(id);};
  let next=0;const requests=[],sub={endpoint:'https://fcm.googleapis.com/this-device'};
  const context=vm.createContext({document:{querySelector:id=>id==='#notifications-enabled'?null:node(id),createElement:()=>node('created-'+next++)},window:{Notification:{permission:'granted'},PushManager:{}},navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>ready?sub:null}})}},state:{pushReady:true,pushKey:'configured'},deps:{api:async(path,data)=>{requests.push({path,data});return {subscribed:true,message:'Queued'};},action:fn=>fn(),toast(){}},Date});
  vm.runInContext(source,context);await vm.runInContext('bindNotifications(state,deps)',context);
  const buttons=[...nodes.values()].filter(n=>n.onclick),ids=buttons.map(b=>b.id);
  assert.equal(ids.includes('enable-push'),!ready);assert.equal(ids.includes('test-push'),ready);assert.equal(ids.includes('disable-push'),ready);
  if(ready){await buttons.find(b=>b.id==='delay-push').onclick();assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))),{path:'push-test',data:{delayed:true,endpoint:sub.endpoint}});}
 }
});

async function switchFixture(ready=false){
 const source=readFileSync(new URL('../public/notifications.js',import.meta.url),'utf8').replaceAll('export ','');
 const toggle={isConnected:true,disabled:true,checked:false,addEventListener(name,fn){this[name]=fn;}},hint={textContent:'',hidden:true,append(){}};
 const device={subscribed:ready,registered:ready,permission:'granted',grant:'granted',permissionRequests:0,fail:null,errors:[],requests:[]};
 const sub={endpoint:'https://fcm.googleapis.com/this-device',toJSON(){return {endpoint:this.endpoint};},unsubscribe:async()=>{device.subscribed=false;}};
 const reg={active:{},pushManager:{getSubscription:async()=>device.subscribed?sub:null,subscribe:async()=>{device.subscribed=true;return sub;}}};
 const Notification={get permission(){return device.permission;},requestPermission:async()=>{device.permissionRequests++;device.permission=device.grant;return device.grant;}};
 const api=async(path,data)=>{
  device.requests.push({path,data});if(path===device.fail)throw Error('Could not save notification settings.');
  if(path==='subscribe')device.registered=true;if(path==='unsubscribe')device.registered=false;
  return {subscribed:device.registered};
 };
 const context=vm.createContext({document:{querySelector:id=>id==='#notifications-enabled'?toggle:id==='#notifications-hint'?hint:null,createElement:()=>({})},window:{Notification,PushManager:{}},navigator:{serviceWorker:{getRegistration:async()=>reg}},state:{pushReady:true,pushKey:'YWJj'},deps:{api,toast(){},action:async fn=>{toggle.disabled=true;try{await fn();}catch(e){device.errors.push(e.message);}finally{toggle.disabled=false;}}},atob,Uint8Array});
 vm.runInContext(source,context);await vm.runInContext('bindNotifications(state,deps)',context);
 return {device,toggle,hint,change:async checked=>{toggle.checked=checked;await toggle.change({target:toggle});}};
}

test('the Settings notification switch checks this device and enables or disables only its subscription',async()=>{
 const f=await switchFixture();assert.equal(f.toggle.checked,false);assert.equal(f.toggle.disabled,false);assert.equal(f.device.permissionRequests,0);
 await f.change(true);assert.equal(f.toggle.checked,true);assert.equal(f.device.permissionRequests,1);assert.equal(f.device.registered,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.device.requests.find(r=>r.path==='subscribe').data)),{endpoint:'https://fcm.googleapis.com/this-device'});
 await f.change(false);assert.equal(f.toggle.checked,false);assert.equal(f.device.subscribed,false);assert.equal(f.device.registered,false);
 assert.equal(f.device.requests.find(r=>r.path==='unsubscribe').data.endpoint,'https://fcm.googleapis.com/this-device');
});

test('the notification switch recovers its real state after failed registration or disabling',async()=>{
 const f=await switchFixture();f.device.fail='subscribe';await f.change(true);
 assert.equal(f.toggle.checked,false);assert.equal(f.toggle.disabled,false);assert.equal(f.device.registered,false);
 f.device.fail=null;await f.change(true);assert.equal(f.toggle.checked,true);
 f.device.fail='unsubscribe';await f.change(false);
 assert.equal(f.toggle.checked,true);assert.equal(f.toggle.disabled,false);assert.equal(f.device.subscribed,true);assert.equal(f.device.registered,true);
 assert.equal(f.device.errors.length,2);
});

test('denied notification permission leaves the switch off with a device-settings explanation',async()=>{
 const f=await switchFixture();f.device.grant='denied';await f.change(true);
 assert.equal(f.toggle.checked,false);assert.equal(f.toggle.disabled,true);assert.equal(f.device.registered,false);
 assert.equal(f.hint.hidden,false);assert.match(f.hint.textContent,/device settings/);assert.equal(f.device.requests.length,0);
});

test('push tests and delivery diagnostics stay on the selected subscribed device',async()=>{
 const {DB,sqlite}=database(),origin='https://test.example',secret='test-only',expiry=String(Date.now()+60000),cookie=`sm_session=${expiry}.${await sign(expiry,secret)}`;
 const endpoints=['https://fcm.googleapis.com/device-a','https://fcm.googleapis.com/device-b'];
 async function req(path,data,authenticated=true){return worker.fetch(new Request(origin+'/api/'+path,{method:'POST',headers:{Origin:origin,Cookie:authenticated?cookie:'','Content-Type':'application/json'},body:JSON.stringify(data)}),{DB,APP_PASSWORD:'test-only',AUTH_SECRET:secret});}
 try{
  for(const endpoint of endpoints)sqlite.prepare('INSERT INTO subscriptions VALUES (?,?)').run(await digest(endpoint),JSON.stringify({endpoint}));
  assert.equal((await req('push-status',{endpoint:endpoints[0]},false)).status,401);
  assert.equal((await req('push-test',{delayed:true})).status,400);
  assert.equal((await req('push-test',{endpoint:'not-registered',delayed:true})).status,400);
  assert.equal((await(await req('push-status',{endpoint:endpoints[0]})).json()).subscribed,true);
  assert.equal((await req('push-test',{endpoint:endpoints[0],delayed:true})).status,200);
  const rows=sqlite.prepare('SELECT * FROM deliveries').all();assert.equal(rows.length,1);assert.equal(rows[0].subscription_id,await digest(endpoints[0]));
  assert.equal((await(await req('deliveries',{endpoint:endpoints[1]})).json()).length,0);
  assert.equal((await(await req('deliveries',{endpoint:endpoints[0]})).json()).length,1);
 }finally{sqlite.close();}
});
