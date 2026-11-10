import {test} from 'node:test';
import assert from 'node:assert/strict';
import rawWorker from '../src/worker.js';
const worker=testWorker(rawWorker);

import {database,testCookie,testWorker} from '../test-support/db.js';

async function request(DB,path,data){
 const expiry=String(Date.now()+60000),secret='test-only';
 return worker.fetch(new Request('https://test.example/api/'+path,{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json',Cookie:await testCookie(DB)},body:JSON.stringify(data)}),{DB,APP_PASSWORD:'test-only',AUTH_SECRET:secret});
}
test('deadline retry after a lost response creates one record and never overwrites different saved work',async()=>{
 const {DB,sqlite}=database();
 try{
  const data={id:crypto.randomUUID(),course:'TEST101',title:'Deadline',due:'2030-01-01T12:00:00+08:00',reminder_minutes:120};
  assert.equal((await request(DB,'tasks',data)).status,200);
  assert.equal((await request(DB,'tasks',data)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,1);
  sqlite.prepare("UPDATE tasks SET status='done' WHERE id=?").run(data.id);
  assert.equal((await request(DB,'tasks',data)).status,200);
  assert.equal(sqlite.prepare('SELECT status FROM tasks').get().status,'done');
  assert.equal((await request(DB,'tasks',{...data,title:'Changed after uncertain save'})).status,409);
  assert.equal(sqlite.prepare('SELECT title FROM tasks').get().title,'Deadline');
  for(const id of ['assign-123',['bad'],{id:'bad'}])assert.equal((await request(DB,'tasks',{...data,id})).status,400);
  assert.equal((await request(DB,'tasks',{...data,id:undefined})).status,200,'older clients can still create deadlines');
 }finally{sqlite.close();}
});
test('class retry uses the same record and keeps its semester association',async()=>{
 const {DB,sqlite}=database();
 try{
  const data={id:crypto.randomUUID(),course:'TEST101',kind:'Lecture',starts:'2030-01-01T12:00:00+08:00',ends:'2030-01-01T13:00:00+08:00',room:'A'};
  assert.equal((await request(DB,'classes',data)).status,200);
  sqlite.exec("INSERT INTO semesters (id,definition,revision) VALUES ('term','{}',1)");
  sqlite.prepare('INSERT INTO class_occurrences (class_id,semester_id,series_id,date) VALUES (?,?,?,?)').run(data.id,'term','weekly','2030-01-01');
  assert.equal((await request(DB,'classes',data)).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM classes').get().n,1);
  assert.equal(sqlite.prepare('SELECT semester_id,overridden FROM class_occurrences').get().semester_id,'term');
  assert.equal(sqlite.prepare('SELECT overridden FROM class_occurrences').get().overridden,1);
 }finally{sqlite.close();}
});
