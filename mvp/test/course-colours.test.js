import {test} from 'node:test';
import assert from 'node:assert/strict';
import {presentCourses} from '../src/moodle.js';
test('connected courses retain imported colours and canonical timetable codes',()=>{
 const courses=[{id:900001,code:'TEST101',color:'#147870'},{id:900002,code:'TEST102',color:'#6c4cbf'}];
 const result=presentCourses(courses.map(c=>({...c,code:c.code+'_REMOTE',color:'#4263b5'})),courses);
 assert.deepEqual(result.map(c=>[c.code,c.color]),courses.map(c=>[c.code,c.color]));
});
test('manual courses without remote IDs retain their own presentation',()=>{
 const saved=[{code:'TEST101',color:'#147870'},{code:'TEST102',color:'#6c4cbf'}];
 assert.deepEqual(presentCourses(saved,saved),saved);
});
test('reconnecting preserves saved presentation by course ID and gives new courses stable colours',()=>{
 const saved=[{id:900001,code:'TEST101',color:'#147870'}];
 const result=presentCourses([{id:900001,code:'TEST101_NEW',name:'Test'}],saved);
 assert.equal(result[0].code,'TEST101');assert.equal(result[0].color,'#147870');
 const fresh=[{id:900002,code:'TEST102'},{id:900003,code:'TEST103'}];
 const first=presentCourses(fresh);assert.notEqual(first[0].color,first[1].color);
 assert.deepEqual(presentCourses([...fresh].reverse()).reverse(),first);
});
