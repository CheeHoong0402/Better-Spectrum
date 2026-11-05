import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const empty=()=>({courses:[],classes:[],tasks:[],updates:[],semesters:[],partial:[]});
function app(){
 const nodes=new Map(),node=s=>{
  if(!nodes.has(s))nodes.set(s,{hidden:true,disabled:false,textContent:'',innerHTML:'',events:{},elements:{},style:{},dataset:{},open:false,
   addEventListener(k,f){this.events[k]=f;},querySelectorAll(){return [];},setAttribute(){},removeAttribute(){},reset(){},
   showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(s);
 };
 for(const k of ['type','id','course','kind','room','occ','starts','ends'])node('#editor-form').elements[k]={value:'',innerHTML:''};
 const sandbox=vm.createContext({document:{querySelector:node,querySelectorAll:s=>s==='dialog[open]'?[...nodes.values()].filter(n=>n.open):[],body:node('body')},window:{addEventListener(){},scrollTo(){}},navigator:{onLine:true},location:{hash:'#tasks'},fetch:()=>new Promise(()=>{}),setTimeout(){},clearTimeout(){},setInterval(){},AbortSignal,crypto,Date,Intl,URL,FormData:class{constructor(form){return Object.entries(form.values);}},attendancePanel:()=>'',bindAttendance(){},bindSemester(){},applyTimetableLayout(){}});
 vm.runInContext(source,sandbox);
 // Rendering has separate view tests; leave real load, editor and submit behaviour under test here.
 vm.runInContext('render=()=>{};',sandbox);
 return {node,run:code=>vm.runInContext(code,sandbox),setFetch:fn=>sandbox.fetch=fn};
}
function entry(a,type='task'){
 a.run(`state=${JSON.stringify({...empty(),courses:[{code:'TEST101'}]})};editor('${type}');`);
 const form=a.node('#editor-form');form.values={type,id:form.elements.id.value,course:'TEST101',title:'My deadline',due:'2030-01-01T12:00',starts:'2030-01-01T12:00',ends:'2030-01-01T13:00'};
 return {preventDefault(){},target:form};
}
test('rapid save is blocked, failed save retains inputs and retry retains its ID',async()=>{
 const a=app(),event=entry(a);let finish,calls=0,ids=[];
 a.setFetch((url,options)=>{calls++;ids.push(JSON.parse(options.body).id);return new Promise(resolve=>finish=resolve);});
 const save=a.node('#editor-form').events.submit(event);
 assert.equal(a.node('#editor-fields').disabled,true);assert.equal(a.node('#save-editor').textContent,'Saving…');
 await a.node('#editor-form').events.submit(event);assert.equal(calls,1);
 finish(Response.json({error:'Temporary failure'},{status:503}));await save;
 assert.equal(a.node('#editor').open,true);assert.equal(a.node('#editor-fields').disabled,false);
 assert.equal(event.target.values.title,'My deadline');assert.match(a.node('#form-error').textContent,/still here/);
 a.setFetch(async(url,options)=>{if(options.body){ids.push(JSON.parse(options.body).id);return Response.json({ok:true});}return Response.json(empty());});
 await a.node('#editor-form').events.submit(event);
 assert.equal(ids[0],ids[1]);assert.equal(a.node('#editor').open,false);
});
test('save followed by failed refresh reports saved work persistently and retries the refresh only',async()=>{
 const a=app(),event=entry(a);let creates=0;
 a.setFetch(async(url,options)=>{if(options.body){creates++;return Response.json({ok:true});}throw Error('Offline');});
 await a.node('#editor-form').events.submit(event);
 assert.equal(creates,1);assert.equal(a.node('#editor').open,false);assert.equal(a.node('#load-status').hidden,false);
 assert.match(a.node('#load-message').textContent,/Saved to your planner, but/);assert.equal(a.node('#toast').textContent,'');
 a.setFetch(async()=>Response.json(empty()));await a.node('#retry-load').onclick();
 assert.equal(a.node('#load-status').hidden,true);assert.equal(creates,1);
});
test('offline first load, expired sign-in, and a server failure have distinct recovery states',async()=>{
 const a=app();a.run('navigator.onLine=false;');a.setFetch(async()=>{throw Error('Offline');});
 assert.equal(await a.run('load()'),false);assert.equal(a.node('#login').hidden,true);assert.equal(a.node('#load-title').textContent,'You’re offline');
 a.setFetch(async()=>Response.json({error:'Sign in again'},{status:401}));await a.run('load()');
 assert.equal(a.node('#login').hidden,false);assert.equal(a.node('#load-status').hidden,true);
 a.run('navigator.onLine=true;');a.setFetch(async()=>Response.json(empty()));await a.run('load()');
 assert.equal(a.node('#app').hidden,false);assert.equal(a.node('#login').hidden,true);
 a.setFetch(async()=>new Response('Unavailable',{status:502}));await a.run('load()');
 assert.equal(a.node('#app').hidden,false);assert.match(a.node('#load-message').textContent,/last loaded records/);
 assert.match(a.node('#load-message').textContent,/unexpected response/);
});
test('first-use setup resumes the requested class or deadline after courses become available',async()=>{
 for(const type of ['task','class']){
  const a=app();a.run(`state=${JSON.stringify(empty())};editor('${type}');`);
  assert.equal(a.node('#course-setup').open,true);assert.equal(a.node('#editor').open,false);
  a.node('#course-setup').close();
  a.setFetch(async()=>Response.json({...empty(),courses:[{code:'TEST101'}]}));await a.run('load()');
  assert.equal(a.node('#editor').open,true);assert.equal(a.node('#editor-form').elements.type.value,type);
  assert.match(a.node('#editor-form').elements.course.innerHTML,/TEST101/);
 }
 const a=app();a.run(`state=${JSON.stringify(empty())};editor('task');`);a.node('#close-setup').onclick();
 a.setFetch(async()=>Response.json({...empty(),courses:[{code:'TEST101'}]}));await a.run('load()');assert.equal(a.node('#editor').open,false);
});
