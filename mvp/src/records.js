import {semesterClasses} from './semester.js';
import {validDate} from './security.js';

export class RecordError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const trashKey=(type,id)=>`removed:${type}:${id}`;
const table=type=>{if(!['task','class'].includes(type))throw new RecordError('Choose a class or manual deadline.');return type==='task'?'tasks':'classes';};
const editable=t=>[t.course,t.title,t.due,t.reminder_minutes];
const recordFields={task:['id','course','title','due','status','source','url','reminder_minutes'],class:['id','course','kind','starts','ends','room','occ','source','reminder_minutes']};

export async function updateTask(db,data){
 if(typeof data.id!=='string'||typeof data.title!=='string'||!data.title.trim()||data.title.length>180||typeof data.course!=='string'||!data.course.trim()||data.course.length>50||!validDate(data.due)||!Number.isInteger(Number(data.reminder_minutes))||Number(data.reminder_minutes)<0||Number(data.reminder_minutes)>10080)throw new RecordError('Enter a course, title, valid due date and reminder.');
 const current=await db.prepare('SELECT * FROM tasks WHERE id=?').bind(data.id).first();
 if(current?.source!=='manual')throw new RecordError('Only your manual deadlines can be edited here.');
 const values=[data.course.trim(),data.title.trim(),new Date(data.due).toISOString(),Number(data.reminder_minutes)];
 if(JSON.stringify(editable(current))!==JSON.stringify(values)){
  if(!data.original||JSON.stringify(editable(current))!==JSON.stringify(editable(data.original)))throw new RecordError('This deadline changed. Refresh to choose the saved version or keep your draft for review.',409);
  const changed=await db.prepare("UPDATE tasks SET course=?,title=?,due=?,reminder_minutes=? WHERE id=? AND source='manual' AND course=? AND title=? AND due=? AND reminder_minutes=? RETURNING id").bind(...values,data.id,...editable(current)).first();
  if(!changed)throw new RecordError('This deadline changed. Refresh to choose the saved version or keep your draft for review.',409);
 }
 await db.prepare("DELETE FROM deliveries WHERE sent IS NULL AND substr(id,1,length(?)+6)='task:'||?||':'").bind(data.id,data.id).run();
 return {ok:true};
}

export async function removedRecords(db,semesters){
 const saved=(await db.prepare("SELECT value FROM settings WHERE key LIKE 'removed:%'").all()).results.map(r=>JSON.parse(r.value));
 const cancelled=(await db.prepare('SELECT * FROM class_occurrences WHERE cancelled=1').all()).results;
 for(const link of cancelled){
  if(saved.some(r=>r.type==='class'&&r.item.id===link.class_id))continue;
  const semester=semesters.find(s=>s.id===link.semester_id);
  const row=semester&&semesterClasses(semester).find(c=>c.series_id===link.series_id&&c.date===link.date);
  if(row)saved.push({type:'class',item:{...row,id:link.class_id}});
 }
 return saved;
}

export async function removeRecord(db,type,id){
 if(typeof id!=='string'||!id||id.length>300)throw new RecordError('Choose a saved item to remove.');
 const name=table(type),item=await db.prepare(`SELECT * FROM ${name} WHERE id=?`).bind(id).first();
 if(!item)return {ok:true};
 if(type==='task'&&item.source!=='manual')throw new RecordError('SPeCTRUM assignments must be managed in SPeCTRUM.');
 const where="id=?"+(type==='task'?" AND source='manual'":'');
 const snapshot=recordFields[type].map(field=>`'${field}',${field}`).join(',');
 const statements=[db.prepare(`INSERT OR REPLACE INTO settings (key,value) SELECT ?,json_object('type',?,'item',json_object(${snapshot})) FROM ${name} WHERE ${where}`).bind(trashKey(type,id),type,id)];
 if(type==='class')statements.push(
  db.prepare('UPDATE class_occurrences SET overridden=1,cancelled=1 WHERE class_id=?').bind(id),
  db.prepare("UPDATE attendance_sessions SET confirmed_class=NULL,message='Class cancelled · automatic match cleared' WHERE confirmed_class=? AND attempted IS NULL").bind(id)
 );
 statements.push(db.prepare(`DELETE FROM deliveries WHERE sent IS NULL AND substr(id,1,length(?)+?)=?||?||':' AND EXISTS (SELECT 1 FROM ${name} WHERE ${where})`).bind(id,type.length+2,type+':',id,id),db.prepare(`DELETE FROM ${name} WHERE ${where}`).bind(id));
 await db.batch(statements);return {ok:true};
}

export async function restoreRecord(db,type,id){
 if(typeof id!=='string'||!id||id.length>300)throw new RecordError('Choose a removed item to restore.');
 const name=table(type),stored=await db.prepare('SELECT value FROM settings WHERE key=?').bind(trashKey(type,id)).first();
 let removed=stored&&JSON.parse(stored.value);
 if(!removed&&type==='class'){
  const semesters=(await db.prepare('SELECT definition FROM semesters').all()).results.map(s=>JSON.parse(s.definition));
  removed=(await removedRecords(db,semesters)).find(r=>r.type===type&&r.item.id===id);
 }
 if(!removed){if(await db.prepare(`SELECT id FROM ${name} WHERE id=?`).bind(id).first())return {ok:true};throw new RecordError('This item is no longer available to restore.');}
 const item=removed.item;
 if(type==='task'&&item.source!=='manual')throw new RecordError('Only manual deadlines can be restored here.');
 const fields=recordFields[type];
 const statements=[db.prepare(`INSERT INTO ${name} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')}) ON CONFLICT(id) DO NOTHING`).bind(...fields.map(k=>item[k]??null))];
 if(type==='class')statements.push(db.prepare('UPDATE class_occurrences SET overridden=1,cancelled=0 WHERE class_id=?').bind(id),db.prepare("UPDATE attendance_sessions SET confirmed_class=NULL,message='Class restored · waiting for automatic matching' WHERE confirmed_class=? AND attempted IS NULL").bind(id));
 statements.push(db.prepare('DELETE FROM settings WHERE key=?').bind(trashKey(type,id)));
 await db.batch(statements);return {ok:true};
}
