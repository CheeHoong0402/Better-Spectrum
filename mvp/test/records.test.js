import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database,testEnvironment} from '../test-support/db.js';
import {updateTask,removeRecord,restoreRecord,removedRecords} from '../src/records.js';
import {previewSemester,applySemester} from '../src/semester.js';
import {reminders as tick} from '../src/worker.js';

test('manual deadline editing preserves status, rejects stale edits and imported changes, and clears obsolete pending reminders',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.prepare('INSERT INTO tasks (id,course,title,due,status) VALUES (?,?,?,?,?)').run('task','TEST','Old','2030-01-01T00:00:00.000Z','done');
  const original=sqlite.prepare('SELECT * FROM tasks').get();
  sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES (?,?,?,?,?)').run('task:task:old:device','device','{}','2030-01-01',null);
  sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES (?,?,?,?,?)').run('task:task:sent:device','device','{}','2030-01-01','sent');
  const data={id:'task',course:'TEST',title:'New',due:'2030-01-02T00:00:00Z',reminder_minutes:1440,original};
  await updateTask(DB,data);await updateTask(DB,data);
  assert.equal(sqlite.prepare('SELECT status FROM tasks').get().status,'done');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
  await assert.rejects(updateTask(DB,{...data,title:'Stale update'}),/changed/);
  sqlite.prepare("UPDATE tasks SET source='SPeCTRUM'").run();
  await assert.rejects(updateTask(DB,data),/manual/);await assert.rejects(removeRecord(DB,'task','task'),e=>e.status===403);
  assert.equal(sqlite.prepare('SELECT title FROM tasks').get().title,'New');
 }finally{sqlite.close();}
});

test('undo removal restores the same deadline and eligible reminders without repeating sent deliveries',async()=>{
 const {DB,sqlite}=database(),now=Date.parse('2030-01-01T01:00:00Z');
 try{
  sqlite.prepare('INSERT INTO tasks (id,course,title,due) VALUES (?,?,?,?)').run('task','TEST','Deadline','2030-01-01T02:00:00.000Z');
  sqlite.prepare('INSERT OR REPLACE INTO subscriptions (id,value) VALUES (?,?)').run('device','{}');
  await tick(testEnvironment(DB),now);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
  await removeRecord(DB,'task','task');await removeRecord(DB,'task','task');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);assert.equal((await removedRecords(DB,[])).length,1);
  await restoreRecord(DB,'task','task');await restoreRecord(DB,'task','task');await tick(testEnvironment(DB),now);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
  sqlite.prepare("UPDATE deliveries SET sent='sent'").run();
  await removeRecord(DB,'task','task');await restoreRecord(DB,'task','task');await tick(testEnvironment(DB),now);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);assert.equal(sqlite.prepare('SELECT sent FROM deliveries').get().sent,'sent');
 }finally{sqlite.close();}
});

test('restored semester classes preserve individual edits and associations without restoring attendance consent',async()=>{
 const {DB,sqlite}=database();
 try{
  const d={id:'term',revision:0,name:'Term',start:'2030-01-07',end:'2030-01-20',week1:'2030-01-07',teachingWeeks:[1,2],excludedDates:[],series:[{id:'row',course:'TEST',kind:'Lecture',weekday:1,start:'09:00',end:'10:00',room:'Original',weeks:[]}]};
  let p=await previewSemester(DB,d);await applySemester(DB,p.definition,p.token);
  const c=sqlite.prepare('SELECT * FROM classes ORDER BY starts').get();sqlite.prepare("UPDATE classes SET room='Individual edit' WHERE id=?").run(c.id);
  sqlite.prepare('INSERT INTO attendance_sessions (id,course,course_id,cmid,name,row_key,day,label,checked,confirmed_class) VALUES (?,?,?,?,?,?,?,?,?,?)').run('attendance','TEST',1,1,'Class','row','2030-01-07','Class','2030-01-07',c.id);
  await removeRecord(DB,'class',c.id);assert.equal(sqlite.prepare('SELECT confirmed_class FROM attendance_sessions').get().confirmed_class,null);
  await restoreRecord(DB,'class',c.id);await restoreRecord(DB,'class',c.id);
  assert.equal(sqlite.prepare('SELECT room FROM classes WHERE id=?').get(c.id).room,'Individual edit');
  assert.equal(sqlite.prepare('SELECT cancelled FROM class_occurrences WHERE class_id=?').get(c.id).cancelled,0);
  p=await previewSemester(DB,{...d,revision:1});await applySemester(DB,p.definition,p.token);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,2);
  assert.equal(sqlite.prepare('SELECT room FROM classes WHERE id=?').get(c.id).room,'Individual edit');
  assert.equal(sqlite.prepare('SELECT confirmed_class FROM attendance_sessions').get().confirmed_class,null);
  // Older cancellations have no saved snapshot; recover the current weekly occurrence by its original ID.
  sqlite.prepare('DELETE FROM classes WHERE id=?').run(c.id);sqlite.prepare('UPDATE class_occurrences SET cancelled=1 WHERE class_id=?').run(c.id);
  assert.ok((await removedRecords(DB,[p.definition])).some(r=>r.item.id===c.id));await restoreRecord(DB,'class',c.id);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,2);
 }finally{sqlite.close();}
});

test('failed removal rolls back the recovery copy and original record together',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.prepare('INSERT INTO tasks (id,course,title,due) VALUES (?,?,?,?)').run('task','TEST','Keep me','2030-01-01T00:00:00Z');
  sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(removeRecord(DB,'task','task'),/test failure/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);assert.equal((await removedRecords(DB,[])).length,0);
 }finally{sqlite.close();}
});

test('failed imported deletion keeps its record, visibility and pending reminder',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.prepare("INSERT INTO content_scopes (id,course,allowed) VALUES ('module:1','TEST',1)").run();
  sqlite.prepare("INSERT INTO tasks (id,course,title,due,source) VALUES ('assign-1','TEST','Assignment','2030-01-01','SPeCTRUM')").run();
  sqlite.prepare("INSERT INTO deliveries (id,subscription_id,payload,due) VALUES ('task:assign-1:pending:device','device','{}','2030-01-01')").run();
  sqlite.exec("CREATE TRIGGER fail_hide BEFORE INSERT ON user_settings WHEN NEW.key='removed:task:assign-1' BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  await assert.rejects(removeRecord(DB,'task','assign-1'),/test failure/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tasks').get().n,1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
  assert.equal((await removedRecords(DB,[])).length,0);
 }finally{sqlite.close();}
});

test('Undo captures deadline and class edits arriving immediately before the removal transaction',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.prepare('INSERT INTO tasks (id,course,title,due) VALUES (?,?,?,?)').run('task','TEST','Original','2030-01-01T00:00:00Z');
  sqlite.prepare('INSERT INTO classes (id,course,kind,starts,ends,room) VALUES (?,?,?,?,?,?)').run('class','TEST','Lab','2030-01-01T00:00:00Z','2030-01-01T01:00:00Z','Original');
  let removals=0;
  const racing={...DB,batch:statements=>{
   sqlite.exec(removals++===0?"UPDATE tasks SET title='Latest deadline',status='done',reminder_minutes=60":"UPDATE classes SET room='Latest room',occ='3',reminder_minutes=30");
   return DB.batch(statements);
  }};
  await removeRecord(racing,'task','task');await restoreRecord(DB,'task','task');
  const task=sqlite.prepare('SELECT * FROM tasks').get();
  assert.equal(task.title,'Latest deadline');assert.equal(task.status,'done');assert.equal(task.reminder_minutes,60);
  await removeRecord(racing,'class','class');await restoreRecord(DB,'class','class');
  const lesson=sqlite.prepare('SELECT * FROM classes').get();
  assert.equal(lesson.room,'Latest room');assert.equal(lesson.occ,'3');assert.equal(lesson.reminder_minutes,30);
 }finally{sqlite.close();}
});

test('removal still protects imported deadlines if the source changes before the transaction',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.prepare('INSERT INTO tasks (id,course,title,due) VALUES (?,?,?,?)').run('task','TEST','Deadline','2030-01-01T00:00:00Z');
  sqlite.prepare('INSERT INTO deliveries (id,subscription_id,payload,due) VALUES (?,?,?,?)').run('task:task:pending:device','device','{}','2030-01-01');
  const racing={...DB,batch:statements=>{sqlite.exec("UPDATE tasks SET source='SPeCTRUM'");return DB.batch(statements);}};
  await removeRecord(racing,'task','task');
  assert.equal(sqlite.prepare('SELECT source FROM tasks').get().source,'SPeCTRUM');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,1);
  assert.equal((await removedRecords(DB,[])).length,0);
 }finally{sqlite.close();}
});
