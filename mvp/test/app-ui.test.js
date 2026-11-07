import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {plainText,courseLabel,pendingTask,taskGroup,orderedTasks} from '../public/presentation.js';
import {semesterForDate} from '../public/timetable.js';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const empty=()=>({courses:[],classes:[],tasks:[],updates:[],semesters:[],partial:[]});
function app(){
 const drafts=new Map(),nodes=new Map(),node=s=>{
  if(!nodes.has(s))nodes.set(s,{hidden:true,disabled:false,textContent:'',innerHTML:'',events:{},elements:{},style:{},dataset:{},open:false,isConnected:true,children:[],append(child){this.children.push(child);},focus(){},
   addEventListener(k,f){this.events[k]=f;},querySelectorAll(){return [];},setAttribute(){},removeAttribute(){},reset(){},
   showModal(){this.open=true;},close(){this.open=false;}});
  return nodes.get(s);
 };
 for(const k of ['type','id','edit','original','course','kind','room','occ','starts','ends','title','due','reminder_minutes'])node('#editor-form').elements[k]={value:'',innerHTML:''};
 const sandbox=vm.createContext({document:{querySelector:node,createElement:()=>node('created:'+nodes.size),querySelectorAll:s=>s==='dialog[open]'?[...nodes.values()].filter(n=>n.open):[],body:node('body')},window:{addEventListener(){},scrollTo(){}},navigator:{onLine:true},location:{hash:'#tasks'},fetch:()=>new Promise(()=>{}),setTimeout(){},clearTimeout(){},setInterval(){},AbortSignal,crypto,Date,Intl,URL,plainText,courseLabel,pendingTask,taskGroup,orderedTasks,semesterForDate,readDraft:key=>drafts.get(key),writeDraft:(key,value)=>drafts.set(key,structuredClone(value)),deleteDraft:key=>drafts.delete(key),clearDrafts:()=>drafts.clear(),draftsNeedWarning:()=>false,resetSemesterDraft(){},FormData:class{constructor(form){return Object.entries({...form.values,original:form.elements.original.value});}},bindAttendance(){},bindSemester(){},bindNotifications(){},applyTimetableLayout(){}});
 vm.runInContext(source,sandbox);
 // Rendering has separate view tests; leave real load, editor and submit behaviour under test here.
 vm.runInContext('var renderViews=render;render=()=>{};',sandbox);
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

test('closing and reopening restores the unfinished editor and discard clears it',()=>{
 const a=app(),event=entry(a);event.target.values.title='Unfinished deadline';
 a.node('#editor-form').events.input();a.node('#close-editor').onclick();a.run("editor('task')");
 assert.equal(a.node('#editor-form').elements.title.value,'Unfinished deadline');
 assert.match(a.node('#form-error').textContent,/draft has been restored/);
 a.run('confirm=()=>true;');a.node('#discard-editor').onclick();
 a.run("editor('task')");assert.doesNotMatch(a.node('#form-error').textContent,/restored/);
});

test('manual edit sends the baseline for conflict protection and a successful save clears its draft',async()=>{
 const a=app(),original={id:'task',course:'TEST101',title:'Original',due:'2030-01-01T00:00:00Z',reminder_minutes:120,source:'manual'};
 a.run(`state=${JSON.stringify({...empty(),courses:[{code:'TEST101'}],tasks:[original]})};editor('task','task');`);
 const form=a.node('#editor-form');form.values={type:'task',id:'task',edit:'yes',original:JSON.stringify(original),course:'TEST101',title:'Corrected',due:'2030-01-02T12:00',reminder_minutes:'1440'};
 let sent;
 a.setFetch(async(url,options)=>{if(options.body){sent={url,data:JSON.parse(options.body)};return Response.json({ok:true});}return Response.json(empty());});
 await form.events.submit({preventDefault(){},target:form});
 assert.equal(sent.url,'/api/task-update');assert.equal(sent.data.original.title,'Original');assert.equal(sent.data.title,'Corrected');
 assert.equal(a.run("readDraft('editor:task:task')"),undefined);
});

test('manual deadline edits have a timeout and retain their ID and input for retry',async()=>{
 const a=app(),original={id:'task',course:'TEST101',title:'Original',due:'2030-01-01T00:00:00Z',reminder_minutes:120,source:'manual'};
 a.run(`state=${JSON.stringify({...empty(),courses:[{code:'TEST101'}],tasks:[original]})};editor('task','task');`);
 const form=a.node('#editor-form');form.values={type:'task',id:'task',edit:'yes',course:'TEST101',title:'Corrected',due:'2030-01-02T12:00',reminder_minutes:'60'};
 let fail,signal;const sent=[];
 a.setFetch((url,options)=>{assert.equal(url,'/api/task-update');sent.push(JSON.parse(options.body));signal=options.signal;return new Promise((resolve,reject)=>fail=reject);});
 const event={preventDefault(){},target:form},pending=form.events.submit(event);
 assert.ok(signal instanceof AbortSignal);assert.equal(a.node('#editor-fields').disabled,true);
 fail(new DOMException('Timed out','TimeoutError'));await pending;
 assert.equal(a.node('#editor-fields').disabled,false);assert.equal(a.node('#editor').open,true);
 assert.equal(form.values.title,'Corrected');assert.match(a.node('#form-error').textContent,/try again/);
 a.setFetch(async(url,options)=>{if(options.body){sent.push(JSON.parse(options.body));return Response.json({ok:true});}return Response.json(empty());});
 await form.events.submit(event);
 assert.equal(sent.length,2);assert.deepEqual(sent[1],sent[0]);assert.equal(a.node('#editor').open,false);
});

test('stale deadline drafts require an explicit choice and keep typed fields when reapplied',()=>{
 const a=app(),old={id:'task',course:'TEST101',title:'Original',due:'2030-01-01T00:00:00Z',reminder_minutes:120,source:'manual'};
 a.run(`state=${JSON.stringify({...empty(),courses:[{code:'TEST101'}],tasks:[old]})};editor('task','task');`);
 const form=a.node('#editor-form');form.values={id:'task',type:'task',edit:'yes',original:JSON.stringify(old),course:'TEST101',title:'My draft',due:'2030-01-02T12:00',reminder_minutes:'1440'};
 form.events.input();a.run("state.tasks[0].title='Latest saved';editor('task','task');");
 assert.equal(a.node('#editor-conflict').hidden,false);assert.equal(a.node('#save-editor').disabled,true);
 assert.equal(form.elements.title.value,'My draft');assert.equal(JSON.parse(form.elements.original.value).title,'Original');
 a.node('#reapply-editor').onclick();
 assert.equal(a.node('#editor-conflict').hidden,true);assert.equal(a.node('#save-editor').disabled,false);
 assert.equal(form.elements.title.value,'My draft');assert.equal(JSON.parse(form.elements.original.value).title,'Latest saved');
 assert.match(a.node('#form-error').textContent,/Review every field/);
 assert.equal(JSON.parse(a.run("readDraft('editor:task:task').original")).title,'Latest saved');
 a.run("editor('task','task')");assert.equal(a.node('#editor-conflict').hidden,true);
 a.node('#reload-editor').onclick();assert.equal(form.elements.title.value,'Latest saved');
});

test('actions show progress, reject repeated work visibly, and retain errors with safe retry',async()=>{
 const a=app();let reject,calls=0;
 const button={id:'sync',tagName:'BUTTON',textContent:'Check now',disabled:false,isConnected:false,setAttribute(){},removeAttribute(){},closest(){return null;}};
 const work=()=>{calls++;return new Promise((resolve,no)=>reject=no);};
 // Pass real functions through the VM without replacing the action implementation.
 a.run('var work,control;');
 const first=a.run('action');
 const pending=first(work,button);
 assert.equal(button.disabled,true);assert.equal(button.textContent,'Checking courses…');
 await first(work,button);assert.equal(calls,1);assert.match(a.node('#action-status').textContent,/still running/);
 reject(new Error('Temporary failure'));await pending;
 assert.equal(button.disabled,false);assert.equal(button.textContent,'Check now');
 assert.match(a.node('#action-status').textContent,/Temporary failure/);
 assert.equal(a.node('#action-status').children.at(-1).textContent,'Try again');
});

test('switch progress stays outside its label and the control unlocks after saving',async()=>{
 const a=app(),control={id:'notifications-enabled',type:'checkbox',tagName:'INPUT',checked:true,textContent:'',isConnected:true,disabled:false,closest(){return null;},setAttribute(){},removeAttribute(){},get parentElement(){throw Error('Switch labels must not contain progress text.');}};
 await a.run('action')(async()=>{assert.equal(control.disabled,true);assert.equal(control.checked,true);},control,'Updating notifications…');
 assert.equal(control.disabled,false);assert.equal(control.checked,true);assert.equal(a.node('#action-status').textContent,'Done.');
});

test('semester context uses dates rather than IDs and disconnected status preserves historical sync time',()=>{
 const a=app();a.run(`bind=()=>{};render=renderViews;state=${JSON.stringify({...empty(),semesters:[{id:'z-past',name:'Past',start:'1900-01-01',end:'1900-12-31'},{id:'a-current',name:'Current',start:'2020-01-01',end:'2090-12-31'}],connected:false,connection:'Connected',lastSync:'2026-11-05T00:00:00Z'})};render();`);
 assert.equal(a.node('#semester-label').textContent,'Current');assert.match(a.node('#connection-strip').innerHTML,/Disconnected/);assert.match(a.node('#connection-strip').innerHTML,/Last successful course check/);
 assert.match(a.node('#connection-strip').innerHTML,/#settings\/connection/);
 a.run("state.connected=true;state.partial=[{value:'One course failed'}];render();");assert.match(a.node('#connection-strip').innerHTML,/some course checks need attention/);
 a.run("location.hash='#semester/z-past';semester=()=>'';render();");assert.equal(a.node('#semester-label').textContent,'Past');
});

test('in-app removal confirmation can cancel safely and offers Undo after a confirmed removal',async()=>{
 const a=app(),calls=[];a.run(`state=${JSON.stringify(empty())};remove('task','example');`);
 assert.equal(a.node('#remove-record').open,true);a.node('#cancel-remove').onclick();assert.equal(a.node('#remove-record').open,false);
 a.setFetch(async(url,options)=>{calls.push({url,data:options.body&&JSON.parse(options.body)});return Response.json(options.body?{ok:true}:empty());});
 a.run("remove('task','example')");const button=a.node('#confirm-remove');Object.assign(button,{tagName:'BUTTON',isConnected:false});
 await button.onclick({currentTarget:button});
 assert.equal(calls[0].url,'/api/task-delete');assert.equal(calls[0].data.id,'example');assert.equal(a.node('#remove-record').open,false);
 assert.equal(a.node('#toast').children.at(-1).textContent,'Undo');
});

test('empty states distinguish filters, completion, disconnected setup and first or failed course checks',()=>{
 const a=app();a.run(`state=${JSON.stringify(empty())};`);
 assert.match(a.run('tasks()'),/Connect SPeCTRUM/);assert.match(a.run('updates()'),/Connect to collect/);
 a.run("state.connected=true;state.connection='Connected';");assert.match(a.run('updates()'),/Waiting for the first/);
 a.run("state.lastSync='2026-11-05';");assert.match(a.run('updates()'),/No new course changes/);
 a.run("state.partial=[{value:'Course check failed'}];");assert.match(a.run('updates()'),/checks need attention/);
 a.run("state.tasks=[{course:'A',status:'done',title:'Done',due:'2030-01-01'}];");assert.match(a.run('tasks()'),/all caught up/);
 a.run("filter='B';state.updates=[{course:'A'}];");
 assert.match(a.run('tasks()'),/Clear filters/);assert.match(a.run('updates()'),/Clear filter/);
 assert.doesNotMatch(a.run('updates()'),/first successful/);
 a.run("filter='all';taskFilter='completed';state.tasks=[{course:'A',status:'pending'}];");assert.match(a.run('tasks()'),/No completed deadlines/);
});

test('Updates displays one category at a time and combines category and course filters',()=>{
 const a=app(),updates=[
  {id:'deadline',course:'A',kind:'deadline',title:'Assignment due',body:'Due tomorrow',seen:0},
  {id:'material',course:'A',kind:'material',title:'Lecture notes',body:'Open SPeCTRUM to view the latest version.',seen:1},
  {id:'announcement',course:'B',kind:'announcement',title:'Room change',body:'<script>Private text</script>',seen:0},
  {id:'older-material',course:'A',kind:null,title:'Older update',seen:1},
 ].map(u=>({...u,changed:'2026-11-06T02:00:00Z'}));
 a.run(`state=${JSON.stringify({...empty(),courses:[{code:'A'},{code:'B'}],updates})};`);
 const materials=a.run('updates()');
 assert.match(materials,/Lecture notes|Older update/);assert.doesNotMatch(materials,/Room change|Assignment due/);
 assert.match(materials,/<select id="update-filter"><option value="material" selected>Materials<\/option>/);
 assert.doesNotMatch(materials,/data-update-filter|update-filters/);
 assert.doesNotMatch(materials,/data-seen="material"|Open SPeCTRUM to view the latest version/);
 a.run('bind()');a.node('#update-filter').events.change({target:{value:'announcement'}});const announcements=a.run('updates()');
 assert.match(announcements,/<option value="announcement" selected>Announcements<\/option>/);
 assert.match(announcements,/Room change|data-seen="announcement"/);assert.doesNotMatch(announcements,/Lecture notes|Assignment due|<script>/);
 assert.match(announcements,/&lt;script&gt;Private text&lt;\/script&gt;/);
 a.run("filter='A'");const filtered=a.run('updates()');
 assert.match(filtered,/No announcements for this course/);assert.doesNotMatch(filtered,/Room change|Lecture notes/);
 a.node('#update-filter').events.change({target:{value:'deadline'}});assert.match(a.run('updates()'),/Assignment due|data-seen="deadline"/);
 a.run("filter='C'");assert.match(a.run('updates()'),/Clear filter/);
});
