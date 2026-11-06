import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/drafts.js',import.meta.url),'utf8').replaceAll('export ','');
function storage(){const entries=new Map();return {getItem:key=>entries.get(key)||null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key),get length(){return entries.size;},key:i=>[...entries.keys()][i]};}
test('drafts survive a module reload and clear only planner drafts on sign-out',()=>{
 const sessionStorage=storage();sessionStorage.setItem('unrelated','keep');
 const first=vm.createContext({sessionStorage,structuredClone});vm.runInContext(source,first);
 vm.runInContext("writeDraft('semester:#semester/new',{name:'Unfinished term',series:[{id:'row',weeksText:'1, 3',room:'A'}]})",first);
 const reloaded=vm.createContext({sessionStorage,structuredClone});vm.runInContext(source,reloaded);
 assert.equal(vm.runInContext("readDraft('semester:#semester/new').series[0].weeksText",reloaded),'1, 3');
 vm.runInContext('clearDrafts()',reloaded);assert.equal(sessionStorage.getItem('unrelated'),'keep');assert.equal(vm.runInContext("readDraft('semester:#semester/new')",reloaded),null);
});
test('blocked browser storage retains drafts in memory and requests an unload warning',()=>{
 const context=vm.createContext({structuredClone,sessionStorage:{setItem(){throw Error('Blocked');},getItem(){throw Error('Blocked');},removeItem(){throw Error('Blocked');}}});vm.runInContext(source,context);
 vm.runInContext("writeDraft('editor:task:new',{title:'Keep me'})",context);
 assert.equal(vm.runInContext("readDraft('editor:task:new').title",context),'Keep me');assert.equal(vm.runInContext('draftsNeedWarning()',context),true);
 vm.runInContext("deleteDraft('editor:task:new')",context);assert.equal(vm.runInContext('draftsNeedWarning()',context),false);
});

test('a failed storage write cannot replace newer in-memory edits with an older stored draft',()=>{
 const sessionStorage=storage(),context=vm.createContext({sessionStorage,structuredClone});vm.runInContext(source,context);
 vm.runInContext("writeDraft('editor:task:new',{title:'Earlier text'})",context);
 sessionStorage.setItem=()=>{throw Error('QuotaExceeded');};
 vm.runInContext("writeDraft('editor:task:new',{title:'Latest text'})",context);
 assert.equal(vm.runInContext("readDraft('editor:task:new').title",context),'Latest text');
 assert.equal(vm.runInContext('draftsNeedWarning()',context),true);
});
