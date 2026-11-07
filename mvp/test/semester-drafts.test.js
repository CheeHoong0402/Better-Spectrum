import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from '../test-support/db.js';
import {previewSemester,applySemester} from '../src/semester.js';

function semesterApp(hash='#semester/term',overrides={}){
 const source=readFileSync(new URL('../public/semester.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 const storage=new Map(),nodes=new Map();let context;
 const field=object=>({get value(){return object.value;},set value(v){object.value=v;},focus(){}});
 const rootValues={};
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{events:{},textContent:'',disabled:false,focus(){},addEventListener(k,fn){this.events[k]=fn;}});return nodes.get(selector);};
 const rows=()=>vm.runInContext('draft.series',context).map(row=>({dataset:{series:row.id},querySelector(selector){const name=/data-field="([^"]+)"/.exec(selector)?.[1];return {get value(){return row[name];},focus(){}};}}));
 const form=node('#semester-form');form.querySelector=selector=>{const name=/data-field="([^"]+)"/.exec(selector)?.[1];return rootValues[name]||node(selector);};form.querySelectorAll=()=>rows();
 const state={courses:[],semesters:[{id:'term',revision:1,name:'Term',start:'2030-01-07',end:'2030-01-20',week1:'2030-01-07',teachingWeeks:[1,2],excludedDates:[],series:[{id:'row',course:'TEST101',name:'Full name',kind:'Tutorial',weekday:4,start:'09:15',end:'10:45',room:'A room',occ:'2',weeks:[1]}]}]};
 const document={querySelector:node,querySelectorAll:selector=>selector==='[data-series]'?rows():selector==='[data-remove-series]'?rows().map(r=>({dataset:{removeSeries:r.dataset.series},set onclick(fn){node('remove:'+r.dataset.series).onclick=fn;}})):[]};
 const setup=()=>{
  context=vm.createContext({document,location:{hash},crypto,structuredClone,confirm:()=>true,readDraft:k=>structuredClone(storage.get(k)),writeDraft:(k,v)=>storage.set(k,structuredClone(v)),deleteDraft:k=>storage.delete(k)});
  vm.runInContext(source,context);context.state=state;
  context.deps={render:()=>context.draw(),fmt:String,...overrides};
  const bind=()=>vm.runInContext('bindSemester(state,deps)',context);
  context.draw=()=>{vm.runInContext('semesterView(state)',context);const draft=vm.runInContext('draft',context);for(const k of ['name','start','end','week1','teachingText','excludedText'])rootValues[k]=field({value:draft[k]});bind();};context.draw();
 };
 setup();return {storage,node,state,rootValues,setup,run:code=>vm.runInContext(code,context),draw:()=>context.draw()};
}

test('semester row Undo preserves every field through a reload, and discard clears the saved draft',()=>{
 const {storage,node,setup,run}=semesterApp();
 node('remove:row').onclick();
 assert.equal(storage.get('semester:#semester/term').series.length,0);
 setup();assert.equal(run('draft.series.length'),0);
 node('#undo-weekly-class').events.click();
 const restored=JSON.parse(run('JSON.stringify(draft.series[0])'));
 assert.deepEqual(restored,{id:'row',course:'TEST101',name:'Full name',kind:'Tutorial',weekday:4,start:'09:15',end:'10:45',room:'A room',occ:'2',weeksText:'1'});
 node('#discard-semester').onclick();assert.equal(storage.has('semester:#semester/term'),false);
});


test('accepted semester saves remain editable after refresh failure, with the saved ID and next revision',async()=>{
 for(const isNew of [false,true]){
  const {DB,sqlite}=database();
  try{
   const api=async(path,data)=>path==='semester-preview'?previewSemester(DB,data.definition):applySemester(DB,data.definition,data.token);
   const a=semesterApp(isNew?'#semester/new':'#semester/term',{api,load:async()=>false,toast(){}});
   let definition={...a.state.semesters[0],revision:0};
   if(!isNew){const first=await previewSemester(DB,definition);await applySemester(DB,first.definition,first.token);definition.revision=1;}
   else a.state.semesters=[];
   definition.name='Accepted semester';
   const approved=await previewSemester(DB,definition);a.run(`preview=${JSON.stringify(approved)};`);
   const button=a.node('#save-semester');await button.onclick({target:button,currentTarget:button});
   assert.equal(a.run('draft.id'),'term');assert.equal(a.run('draft.revision'),definition.revision+1);
   assert.equal(a.run('location.hash'),'#semester/term');assert.equal(a.run('preview'),null);
   assert.equal(a.storage.has('semester:'+(isNew?'#semester/new':'#semester/term')),false);
   a.rootValues.name.value='Further edit';a.node('#semester-form').events.input();
   assert.equal(a.storage.get('semester:#semester/term').name,'Further edit');
   await a.node('#semester-form').events.submit({preventDefault(){},submitter:a.node('preview-button')});
   assert.equal(a.run('preview.definition.name'),'Further edit');
   assert.equal(a.run('preview.definition.revision'),definition.revision+1);
   assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM semesters').get().n,1);
  }finally{sqlite.close();}
 }
});

test('a stale semester draft can be explicitly reapplied or replaced without a refresh loop',()=>{
 for(const choice of ['reapply','reload']){
  const a=semesterApp();a.rootValues.name.value='My semester draft';a.node('#semester-form').events.input();
  a.state.semesters[0]={...a.state.semesters[0],name:'Latest saved semester',revision:2};
  a.setup();const view=a.run('semesterView(state)');
  assert.match(view,/This semester changed/);assert.equal(a.run('draft.revision'),1);
  a.node('#'+choice+'-semester').events.click();
  assert.equal(a.run('draft.revision'),2);
  assert.equal(a.run('draft.name'),choice==='reapply'?'My semester draft':'Latest saved semester');
  assert.doesNotMatch(a.run('semesterView(state)'),/This semester changed/);
  if(choice==='reapply')assert.equal(a.storage.get('semester:#semester/term').revision,2);
  else assert.equal(a.storage.has('semester:#semester/term'),false);
 }
});

test('semester saving stays locked across navigation and unlocks after success or failure',async()=>{
 for(const fails of [false,true]){
  let finish,calls=0;
  const a=semesterApp('#semester/term',{api:()=>{calls++;return new Promise((resolve,reject)=>finish=fails?()=>reject(new Error('Offline')):resolve);},load:async()=>false,toast(){}});
  a.run('preview={definition:definition(),token:"approved"};');
  const button=a.node('#save-semester'),event={target:button,currentTarget:button};
  const pending=button.onclick(event);
  a.run("location.hash='#timetable';location.hash='#semester/term';");a.draw();
  assert.match(a.run('semesterView(state)'),/<fieldset id="semester-fields" disabled>/);
  await a.node('#save-semester').onclick(event);assert.equal(calls,1);
  finish();await pending;
  assert.equal(a.node('#semester-fields').disabled,false);
  assert.doesNotMatch(a.run('semesterView(state)'),/<fieldset id="semester-fields" disabled>/);
  if(fails)assert.match(a.node('#semester-error').textContent,/Offline/);
  else assert.equal(a.run('draft.revision'),2);
 }
});


test('invalid inputs reveal every containing disclosure before focus',()=>{
 const a=semesterApp(),outer={open:false,parentElement:null},inner={open:false,parentElement:{closest:()=>outer}};
 let focused=false;
 a.node('#semester-form').events.invalid({target:{closest:()=>inner,focus(){focused=true;}}});
 assert.equal(inner.open,true);assert.equal(outer.open,true);assert.equal(focused,true);
});

test('editing after a preview hides confirmation until another preview succeeds',async()=>{
 const a=semesterApp('#semester/term',{api:async()=>({definition:{...JSON.parse(a.run('JSON.stringify(definition())'))},token:'preview',counts:{added:1,updated:0,removed:0,kept:0,cancelled:0},classes:[]})});
 await a.node('#semester-form').events.submit({preventDefault(){},submitter:a.node('preview-button')});
 assert.equal(a.node('#save-semester').hidden,false);assert.equal(a.node('#save-semester').disabled,false);
 a.rootValues.name.value='Changed after preview';a.node('#semester-form').events.input();
 assert.equal(a.node('#save-semester').hidden,true);assert.equal(a.node('#save-semester').disabled,true);assert.equal(a.run('preview'),null);
 const html=a.run('semesterView(state)');assert.match(html,/<details class="weekly-class"/);assert.match(html,/value="A room"/);assert.match(html,/semester-action-bar/);
});
