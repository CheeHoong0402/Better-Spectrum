import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSemester,semesterClasses,previewSemester,applySemester} from '../src/semester.js';
import worker from '../src/worker.js';
import {sign} from '../src/security.js';
import {database} from '../test-support/db.js';

const definition=()=>({id:'test-semester',revision:0,name:'Example term',start:'2027-01-04',end:'2027-01-31',week1:'2027-01-04',teachingWeeks:[1,2,4],excludedDates:['2027-01-25'],series:[{id:'lecture',course:'EXAMPLE101',name:'Example course',kind:'Lecture',weekday:1,start:'08:00',end:'10:00',room:'Room A',occ:'1',weeks:[]}]});
async function save(DB,d){const p=await previewSemester(DB,d);await applySemester(DB,p.definition,p.token);return p;}
async function request(DB,path,data,authenticated=true){
 const expiry=String(Date.now()+60000),secret='test-only';
 return worker.fetch(new Request('https://test.example/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'https://test.example','Content-Type':'application/json',Cookie:authenticated?`sm_session=${expiry}.${await sign(expiry,secret)}`:''},body:data===undefined?undefined:JSON.stringify(data)}),{DB,APP_PASSWORD:'test-only',AUTH_SECRET:secret,APP_RELEASE:'test-release'});
}

test('semester generation respects teaching weeks, holidays, class weeks and Malaysia time',()=>{
 const d=validateSemester(definition()),rows=semesterClasses(d);
 assert.deepEqual(rows.map(r=>r.starts),['2027-01-04T00:00:00.000Z','2027-01-11T00:00:00.000Z']);
 d.series[0].weeks=[2];assert.equal(semesterClasses(d).length,1);
 d.series[0].weekday=7;d.series[0].start='00:30';d.series[0].end='01:30';
 assert.equal(semesterClasses(d)[0].starts,'2027-01-16T16:30:00.000Z');
});
test('semester input rejects impossible dates, unbounded ranges and invalid weekly classes',()=>{
 for(const change of [{id:undefined},{start:'2027-02-30'},{end:'2029-01-01'},{week1:'2027-01-05'},{teachingWeeks:[0]},{teachingWeeks:[5]},{excludedDates:['2027-02-01']},{series:[]}])assert.throws(()=>validateSemester({...definition(),...change}));
 const d=definition();d.series[0].end='07:00';assert.throws(()=>validateSemester(d));
});
test('duplicate weekly rows are rejected while alternating-week classes are allowed',()=>{
 const d=definition();d.series.push({...d.series[0],id:'other'});
 assert.throws(()=>semesterClasses(validateSemester(d)),/same class/);
 d.series[0].weeks=[1];d.series[1].weeks=[2];assert.equal(semesterClasses(validateSemester(d)).length,2);
});
test('saving and saving again creates no duplicates and adopts matching dated records',async()=>{
 const {DB,sqlite}=database();
 try{
  await DB.prepare('INSERT INTO classes (id,course,kind,starts,ends,room,occ,source) VALUES (?,?,?,?,?,?,?,?)').bind('existing','EXAMPLE101','Lecture','2027-01-04T08:00:00+08:00','2027-01-04T10:00:00+08:00','My corrected room','1','reviewed import').run();
  const d=definition(),p=await save(DB,d);assert.equal(p.counts.added,1);assert.equal(p.counts.kept,1);
  d.revision=1;const again=await save(DB,d);assert.equal(again.counts.added,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,2);
  assert.equal(sqlite.prepare("SELECT room FROM classes WHERE id='existing'").get().room,'My corrected room');
 }finally{sqlite.close();}
});
test('individual edits and cancellations survive a revised semester and obsolete reminders are removed',async()=>{
 const {DB,sqlite}=database();
 try{
  const d=definition();d.teachingWeeks=[1,2,3,4];d.excludedDates=[];await save(DB,d);
  const rows=sqlite.prepare('SELECT * FROM classes ORDER BY starts').all();
  assert.equal((await request(DB,'classes',{...rows[0],room:'Personal correction'})).status,200);
  await DB.prepare('INSERT INTO deliveries (id,subscription_id,payload,due) VALUES (?,?,?,?)').bind('class:'+rows[1].id+':reminder:device','device','{}','2027-01-01T00:00:00Z').run();
  assert.equal((await request(DB,'class-delete',{id:rows[1].id})).status,200);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
  await DB.prepare('INSERT INTO deliveries (id,subscription_id,payload,due) VALUES (?,?,?,?)').bind('class:'+rows[2].id+':reminder:device','device','{}','2027-01-01T00:00:00Z').run();
  d.revision=1;d.series[0].room='New room';d.teachingWeeks=[1,2,3];
  const p=await save(DB,d);assert.equal(p.counts.cancelled,1);assert.equal(p.counts.removed,1);
  assert.equal(sqlite.prepare('SELECT room FROM classes WHERE id=?').get(rows[0].id).room,'Personal correction');
  assert.equal(sqlite.prepare('SELECT * FROM classes WHERE id=?').get(rows[1].id),undefined);
  assert.equal(sqlite.prepare('SELECT room FROM classes WHERE id=?').get(rows[2].id).room,'New room');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM deliveries').get().n,0);
 }finally{sqlite.close();}
});
test('stale previews and revisions cannot overwrite newer timetable changes',async()=>{
 const {DB,sqlite}=database();
 try{
  const p=await previewSemester(DB,definition());await applySemester(DB,p.definition,p.token);
  await assert.rejects(applySemester(DB,p.definition,p.token),/changed/);
  const d=definition();d.revision=1;const fresh=await previewSemester(DB,d);
  sqlite.prepare("UPDATE classes SET room='edited elsewhere'").run();
  await assert.rejects(applySemester(DB,d,fresh.token),/changed/);
 }finally{sqlite.close();}
});
test('a failed semester write rolls back the definition and every generated class',async()=>{
 const {DB,sqlite}=database();
 try{
  sqlite.exec("CREATE TRIGGER fail_class BEFORE INSERT ON classes BEGIN SELECT RAISE(ABORT,'simulated failure'); END;");
  const p=await previewSemester(DB,definition());await assert.rejects(applySemester(DB,p.definition,p.token),/simulated failure/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM semesters').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM classes').get().n,0);
 }finally{sqlite.close();}
});
test('API requires authentication and preview, and new installations contain no personal records',async()=>{
 const {DB,sqlite}=database();
 try{
  assert.equal((await request(DB,'semester-preview',{definition:definition()},false)).status,401);
  assert.equal((await request(DB,'semester-preview',{definition:{}})).status,400);
  assert.equal((await request(DB,'semester-apply',{definition:definition(),token:'invalid'})).status,409);
  let state=await(await request(DB,'state')).json();assert.deepEqual(state.classes,[]);assert.deepEqual(state.courses,[]);
  const preview=await(await request(DB,'semester-preview',{definition:definition()})).json();
  assert.equal((await request(DB,'semester-apply',{definition:preview.definition,token:preview.token})).status,200);
  state=await(await request(DB,'state')).json();assert.equal(state.courses[0].code,'EXAMPLE101');assert.equal(state.semesters[0].revision,1);assert.equal(state.release,'test-release');
  assert.equal((await request(DB,'version',undefined,false)).status,200);
 }finally{sqlite.close();}
});
