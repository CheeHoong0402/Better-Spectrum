import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupNumbers,courseScope,allowedScope} from '../src/course-scope.js';
import {database} from '../test-support/db.js';
import {tick} from '../src/worker.js';

test('OCC and tutorial labels support lists, ranges and exact group numbers without treating exercise numbers as groups',()=>{
 for(const [label,numbers] of [['OCC 2 &amp;13',[2,13]],['[NRJ] T6, T10, T13 Section',[6,10,13]],['OCC/Group 29',[29]],['OCC 10-12',[10,11,12]],['OCC3, OCC4, OCC5',[3,4,5]],['OCC 7- Tutorial',[7]],['Tutorial 2/week 2',[]],['Week 11',[]],['T-1002-01',[]]])assert.deepEqual(groupNumbers(label,true),numbers);
 assert.deepEqual(groupNumbers('Project Group 2'),[]);
 assert.deepEqual(groupNumbers('OCC&nbsp;10–12'),[10,11,12]);
 const sections=[{id:1,name:'OCC11',modules:[{id:1,name:'Assignment',modname:'assign'}]}];
 assert.equal(courseScope(sections,[1]).modules.length,0);
});

test('other-group restrictions reach native subsections while unlabelled shared submissions stay included',()=>{
 const sections=[
  {id:1,name:'T4',modules:[{id:10,modname:'subsection',customdata:'{"sectionid":"2"}'}]},
  {id:2,component:'mod_subsection',name:'Submissions',modules:[{id:11,name:'Tutorial 2',modname:'assign'}]},
  {id:3,name:'T6, T10, T13',modules:[{id:12,modname:'subsection',customdata:'{"sectionid":4}'}]},
  {id:4,component:'mod_subsection',name:'Submissions',modules:[{id:13,name:'Tutorial 3',modname:'assign'}]},
  {id:5,name:'Unlabelled submissions',modules:[{id:14,name:'Assignment',modname:'assign'},{id:15,name:'OCC 4 only',modname:'resource'},{id:16,name:'Tutorial 2/week 2',modname:'assign'}]},
  {id:6,name:'Hidden',uservisible:false,modules:[{id:17,name:'Assignment',modname:'assign'}]}
 ];
 const scope=courseScope(sections,[10]);
 assert.deepEqual(scope.modules.map(m=>m.id),[12,13,14,16]);
 assert.equal(scope.nodes.find(n=>n.id==='section:2').allowed,false);
});

test('reviewed Flexible Sections parents exclude other lecturers without inferring ownership from source order',()=>{
 const sections=[{id:1,name:'OCC 4',modules:[]},{id:2,name:'OCC 10',modules:[]},{id:3,name:'Lecture slides',modules:[{id:10,name:'Notes'}]},{id:4,name:'Announcements',modules:[{id:11,name:'Class moved'}]},{id:5,name:'Shared news',modules:[{id:12,name:'No group label'}]}];
 assert.deepEqual(courseScope(sections,[10],{parents:{3:1,4:2}}).modules.map(m=>m.id),[11,12]);
});

test('queued posts lose permission when their forum is excluded and old unscoped pushes are discarded',async t=>{
 const {DB,sqlite}=database();t.after(()=>sqlite.close());
 sqlite.prepare('INSERT INTO content_scopes VALUES (?,?,?,?)').run('module:1','TEST',0,null);
 sqlite.prepare('INSERT INTO content_scopes VALUES (?,?,?,?)').run('post:1','TEST',1,'module:1');
 assert.equal(await allowedScope(DB,'post:1'),false);
 sqlite.prepare('INSERT INTO subscriptions VALUES (?,?)').run('device','{}');
 for(const [id,payload] of [['post:1-hash:device',{scope:'post:1'}],['deadline:assign-1:old:device',{}]])sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due) VALUES (?,?,?,?)').run(id,'device',JSON.stringify(payload),'2026-01-01T00:00:00Z');
 const now=Date.now(),oddMinute=now+(Math.floor(now/60000)%2===0?60000:0);
 await tick({DB,VAPID_PUBLIC_KEY:'present',VAPID_PRIVATE_KEY:'present'},oddMinute);
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
});

test('scheduler queues only relevant imported assignments and keeps manual deadlines working',async t=>{
 const {DB,sqlite}=database();t.after(()=>sqlite.close());
 sqlite.prepare('INSERT INTO subscriptions VALUES (?,?)').run('device','{}');
 sqlite.prepare('INSERT INTO content_scopes VALUES (?,?,?,?)').run('module:1','TEST',1,null);
 sqlite.prepare('INSERT INTO content_scopes VALUES (?,?,?,?)').run('module:2','TEST',0,null);
 const now=Date.now(),oddMinute=now+(Math.floor(now/60000)%2===0?60000:0),due=new Date(oddMinute+3600000).toISOString();
 for(const [id,source] of [['assign-1','SPeCTRUM'],['assign-2','SPeCTRUM'],['manual','manual']])sqlite.prepare('INSERT INTO tasks (id,course,title,due,source,reminder_minutes) VALUES (?,?,?,?,?,?)').run(id,'TEST','Deadline',due,source,120);
 await tick({DB},oddMinute);
 const ids=sqlite.prepare('SELECT id FROM deliveries ORDER BY id').all().map(r=>r.id);
 assert.equal(ids.length,2);assert.ok(ids.some(id=>id.startsWith('task:assign-1:')));assert.ok(ids.some(id=>id.startsWith('task:manual:')));
});

test('scope migration preserves records and sent history while cancelling only unsent imported pushes',()=>{
 const {sqlite}=database();
 try{
  for(const [id,sent] of [['task:assign-1:device',null],['module:1-hash:device',null],['post:1-hash:device','2026-01-01'],['task:manual:device',null],['class:manual:device',null],['test:device',null]])sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES (?,?,?,?,?)').run(id,'device','{}','2026-01-01',sent);
  sqlite.exec(readFileSync(new URL('../migrations/0002_course_scope.sql',import.meta.url),'utf8'));
  assert.deepEqual(sqlite.prepare('SELECT id FROM deliveries ORDER BY id').all().map(r=>r.id),['class:manual:device','post:1-hash:device','task:manual:device','test:device']);
 }finally{sqlite.close();}
});
