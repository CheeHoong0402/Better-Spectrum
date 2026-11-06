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
  const context=vm.createContext({document:{querySelector:node,createElement:()=>node('created-'+next++)},window:{Notification:{permission:'granted'},PushManager:{}},navigator:{serviceWorker:{getRegistration:async()=>({pushManager:{getSubscription:async()=>ready?sub:null}})}},state:{pushReady:true,pushKey:'configured'},deps:{api:async(path,data)=>{requests.push({path,data});return {subscribed:true,message:'Queued'};},action:fn=>fn(),toast(){}},Date});
  vm.runInContext(source,context);await vm.runInContext('bindNotifications(state,deps)',context);
  const buttons=[...nodes.values()].filter(n=>n.onclick),ids=buttons.map(b=>b.id);
  assert.equal(ids.includes('enable-push'),!ready);assert.equal(ids.includes('test-push'),ready);assert.equal(ids.includes('disable-push'),ready);
  if(ready){await buttons.find(b=>b.id==='delay-push').onclick();assert.deepEqual(JSON.parse(JSON.stringify(requests.at(-1))),{path:'push-test',data:{delayed:true,endpoint:sub.endpoint}});}
 }
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
