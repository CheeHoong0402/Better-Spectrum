import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWeeks,semesterView} from '../public/semester.js';

test('week entry expands alternating ranges and rejects malformed or excessive input',()=>{
 assert.deepEqual(parseWeeks('1-3, 5, 7-8, 2'),[1,2,3,5,7,8]);
 assert.deepEqual(parseWeeks(''),[]);
 for(const text of ['0','55','3-1','1,,2','1e2','-2','1-9999999'])assert.throws(()=>parseWeeks(text));
});
test('semester editor escapes imported names and requires preview before saving',()=>{
 const old=globalThis.location;globalThis.location={hash:'#semester/test'};
 try{
  const view=semesterView({semesters:[{id:'test',revision:1,name:'<script>bad</script>',start:'2027-01-04',end:'2027-01-31',week1:'2027-01-04',teachingWeeks:[1],excludedDates:[],series:[]}],courses:[]});
  assert.ok(view.includes('&lt;script&gt;'));assert.ok(!view.includes('<script>bad'));
  assert.ok(view.includes('id="save-semester" disabled'));assert.ok(view.includes('role="alert"'));assert.ok(view.includes('role="status"'));
 }finally{globalThis.location=old;}
});
