import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('installed public shell resolves required modules offline, supports navigation, and never handles private API data',async()=>{
 const handlers={},files=new Map();let offline=false,serverError=false;
 const key=request=>typeof request==='string'?request:new URL(request.url).pathname+new URL(request.url).search;
 const caches={open:async()=>({addAll:async paths=>{for(const path of paths){const name=path==='/'?'index.html':path.slice(1).split('?')[0];files.set(path,new Response(readFileSync(new URL('../public/'+name,import.meta.url))));}}}),match:async request=>files.get(key(request))?.clone()};
 const sandbox=vm.createContext({self:{addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},location:{origin:'https://test.example'}},caches,fetch:async()=>{if(offline)throw Error('Offline');return new Response('Unavailable',{status:serverError?503:200});},URL,Response});
 vm.runInContext(readFileSync(new URL('../src/service-worker.js',import.meta.url),'utf8'),sandbox);
 let install;handlers.install({waitUntil:p=>install=p});await install;offline=true;
 async function get(path,mode){let response;handlers.fetch({request:{method:'GET',url:'https://test.example'+path,mode},respondWith:p=>response=p});return response;}
 const shell=await get('/');assert.equal(shell.status,200);assert.match(await shell.text(),/id="load-status"/);
 async function module(path){
  const response=await get(path);assert.equal(response.status,200,path+' is available offline');
  const source=await response.text();
  for(const match of source.matchAll(/^import .*from ['"]\.\/(.+?)['"]/gm))await module('/'+match[1]);
 }
 await module('/app.js');
 const navigation=await get('/some-route','navigate');assert.equal(navigation.status,200);assert.match(await navigation.text(),/id="load-status"/);
 assert.equal(await get('/api/state'),undefined);assert.equal(await get('/api/tasks'),undefined);
 assert.equal([...files.keys()].some(path=>path.startsWith('/api/')),false);
 offline=false;serverError=true;assert.equal((await get('/app.js')).status,200,'temporary server failure can use cached public code');
});
