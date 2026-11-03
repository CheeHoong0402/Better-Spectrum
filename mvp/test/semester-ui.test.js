import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseWeeks,semesterView,copyWeekRows} from '../public/semester.js';

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
test('copying a saved week preserves series identity, class weeks and Malaysia weekday',()=>{
 const previous=[{id:'keep-this-series',course:'EXAMPLE101',name:'My short name',kind:'Lecture',weekday:1,start:'00:30',end:'01:30',occ:'1',weeksText:'1, 3'}];
 const classes=[{course:'EXAMPLE101',kind:'Lecture',starts:'2027-01-03T16:30:00Z',ends:'2027-01-03T17:30:00Z',occ:'1',room:'A'}];
 const localDate=s=>new Date(Date.parse(s)+8*3600000).toISOString().slice(0,10);
 let copied=copyWeekRows(classes,[],previous,localDate);
 assert.equal(copied[0].id,previous[0].id);assert.equal(copied[0].weekday,1);assert.equal(copied[0].weeksText,'1, 3');assert.equal(copied[0].name,'My short name');
 classes[0].starts='2027-01-03T17:00:00Z';classes[0].ends='2027-01-03T18:00:00Z';
 copied=copyWeekRows(classes,[],previous,localDate);assert.equal(copied[0].id,previous[0].id);assert.equal(copied[0].start,'01:00');
});
