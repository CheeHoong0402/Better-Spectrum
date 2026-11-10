import {ownerSQL} from './tenant.js';
import {semesterClasses} from './semester.js';
import {validDate} from './security.js';
import {allowedScope} from './course-scope.js';

export class RecordError extends Error {constructor(message,status=400){super(message);this.status=status;}}
const trashKey=(type,id)=>`removed:${type}:${id}`;
const table=type=>{if(!['task','class'].includes(type))throw new RecordError('Choose a class or deadline.');return type==='task'?'tasks':'classes';};
const editable=t=>[t.course,t.title,t.due,t.reminder_minutes];
const recordFields={task:['id','course','title','due','status','source','url','reminder_minutes'],class:['id','course','kind','starts','ends','room','occ','source','reminder_minutes']};

export async function updateTask(db,data){
 if(typeof data.id!=='string'||typeof data.title!=='string'||!data.title.trim()||data.title.length>180||typeof data.course!=='string'||!data.course.trim()||data.course.length>50||!validDate(data.due)||!Number.isInteger(Number(data.reminder_minutes))||Number(data.reminder_minutes)<0||Number(data.reminder_minutes)>10080)throw new RecordError('Enter a course, title, valid due date and reminder.');
 const current=await db.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?2`).bind(data.id).first();
 if(current?.source!=='manual')throw new RecordError('Only your manual deadlines can be edited here.');
 const values=[data.course.trim(),data.title.trim(),new Date(data.due).toISOString(),Number(data.reminder_minutes)];
 if(JSON.stringify(editable(current))!==JSON.stringify(values)){
  if(!data.original||JSON.stringify(editable(current))!==JSON.stringify(editable(data.original)))throw new RecordError('This deadline changed. Refresh to choose the saved version or keep your draft for review.',409);
  const changed=await db.prepare(`${ownerSQL} UPDATE tasks SET course=?2,title=?3,due=?4,reminder_minutes=?5 WHERE user_id=(SELECT id FROM owner) AND (id=?6 AND source='manual' AND course=?7 AND title=?8 AND due=?9 AND reminder_minutes=?10) RETURNING id`).bind(...values,data.id,...editable(current)).first();
  if(!changed)throw new RecordError('This deadline changed. Refresh to choose the saved version or keep your draft for review.',409);
 }
 await db.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (sent IS NULL AND substr(id,1,length(?2)+6)='task:'||?3||':') `).bind(data.id,data.id).run();
 return {ok:true};
}

export async function removedRecords(db,semesters){
 const saved=(await db.prepare(`${ownerSQL} SELECT value FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) user_settings WHERE key LIKE 'removed:%'`).all()).results.map(r=>JSON.parse(r.value)).filter(r=>r.type!=='task'||r.item.source!=='SPeCTRUM');
 const imported=(await db.prepare(`${ownerSQL} SELECT t.* FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) t JOIN (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) r ON r.key='removed:task:'||t.id WHERE t.source='SPeCTRUM' AND EXISTS (SELECT 1 FROM (SELECT * FROM content_scopes WHERE user_id=(SELECT id FROM owner)) s WHERE s.id='module:'||substr(t.id,8) AND s.allowed=1)`).all()).results;
 saved.push(...imported.map(item=>({type:'task',item})));
 const cancelled=(await db.prepare(`${ownerSQL} SELECT * FROM (SELECT * FROM class_occurrences WHERE user_id=(SELECT id FROM owner)) class_occurrences WHERE cancelled=1`).all()).results;
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
 const name=table(type),item=await db.prepare(`${ownerSQL} SELECT * FROM ${name} WHERE user_id=(SELECT id FROM owner) AND id=?2`).bind(id).first();
 if(!item)return {ok:true};
 if(type==='task'&&item.source==='SPeCTRUM'){
  if(!await allowedScope(db,'module:'+id.slice(7)))throw new RecordError('This assignment is not available for your course group.',403);
  // Keep the imported row current during sync; the recovery marker hides it from the planner and reminders.
  await db.batch([
   db.prepare(`${ownerSQL} INSERT OR IGNORE INTO user_settings (user_id,key,value) SELECT (SELECT id FROM owner),?2,?3 FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?4 AND source='SPeCTRUM'`).bind(trashKey(type,id),JSON.stringify({type,item}),id),
   db.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND (sent IS NULL AND substr(id,1,length(?2)+6)='task:'||?3||':' AND EXISTS (SELECT 1 FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) user_settings WHERE key=?4)) `).bind(id,id,trashKey(type,id))
  ]);return {ok:true};
 }
 if(type==='task'&&item.source!=='manual')throw new RecordError('This deadline cannot be deleted here.');
 const where="user_id=(SELECT id FROM owner) AND id=?4"+(type==='task'?" AND source='manual'":'');
 const snapshot=recordFields[type].map(field=>`'${field}',${field}`).join(',');
 const statements=[db.prepare(`${ownerSQL} INSERT OR REPLACE INTO user_settings (user_id,key,value) SELECT (SELECT id FROM owner),?2,json_object('type',?3,'item',json_object(${snapshot})) FROM ${name} WHERE ${where}`).bind(trashKey(type,id),type,id)];
 if(type==='class')statements.push(
  db.prepare(`${ownerSQL} UPDATE class_occurrences SET overridden=1,cancelled=1 WHERE user_id=(SELECT id FROM owner) AND (class_id=?2) `).bind(id),
  db.prepare(`${ownerSQL} UPDATE attendance_sessions SET confirmed_class=NULL,message='Class cancelled · automatic match cleared' WHERE user_id=(SELECT id FROM owner) AND (confirmed_class=?2 AND attempted IS NULL) `).bind(id)
 );
 statements.push(db.prepare(`${ownerSQL} DELETE FROM deliveries WHERE user_id=(SELECT id FROM owner) AND sent IS NULL AND substr(id,1,length(?2)+?3)=?4||?5||':' AND EXISTS (SELECT 1 FROM ${name} WHERE user_id=(SELECT id FROM owner) AND id=?6 ${type==='task'?"AND source='manual'":''})`).bind(id,type.length+2,type+':',id,id),db.prepare(`${ownerSQL} DELETE FROM ${name} WHERE user_id=(SELECT id FROM owner) AND id=?2`+(type==='task'?" AND source='manual'":'')).bind(id));
 await db.batch(statements);return {ok:true};
}

export async function restoreRecord(db,type,id){
 if(typeof id!=='string'||!id||id.length>300)throw new RecordError('Choose a removed item to restore.');
 const name=table(type),stored=await db.prepare(`${ownerSQL} SELECT value FROM (SELECT * FROM user_settings WHERE user_id=(SELECT id FROM owner)) user_settings WHERE key=?2`).bind(trashKey(type,id)).first();
 let removed=stored&&JSON.parse(stored.value);
 if(!removed&&type==='class'){
  const semesters=(await db.prepare(`${ownerSQL} SELECT definition FROM (SELECT * FROM semesters WHERE user_id=(SELECT id FROM owner)) semesters`).all()).results.map(s=>JSON.parse(s.definition));
  removed=(await removedRecords(db,semesters)).find(r=>r.type===type&&r.item.id===id);
 }
 if(!removed){if(await db.prepare(`${ownerSQL} SELECT id FROM ${name} WHERE user_id=(SELECT id FROM owner) AND id=?2`).bind(id).first())return {ok:true};throw new RecordError('This item is no longer available to restore.');}
 const item=removed.item;
 if(type==='task'&&item.source==='SPeCTRUM'){
  if(!await allowedScope(db,'module:'+id.slice(7)))throw new RecordError('This assignment is not available for your course group.',403);
  const current=await db.prepare(`${ownerSQL} SELECT source FROM (SELECT * FROM tasks WHERE user_id=(SELECT id FROM owner)) tasks WHERE id=?2`).bind(id).first();
  if(current?.source!=='SPeCTRUM')throw new RecordError('This assignment is no longer available to restore.');
  await db.batch([db.prepare(`${ownerSQL} DELETE FROM user_settings WHERE user_id=(SELECT id FROM owner) AND key=?2`).bind(trashKey(type,id)),db.prepare(`${ownerSQL} UPDATE tasks SET remind_at=CAST((julianday(due)-2440587.5)*86400000 AS INTEGER)-reminder_minutes*60000 WHERE user_id=(SELECT id FROM owner) AND id=?2`).bind(id)]);return {ok:true};
 }
 if(type==='task'&&item.source!=='manual')throw new RecordError('This deadline cannot be restored here.');
 const fields=recordFields[type];
 const statements=[db.prepare(`${ownerSQL} INSERT INTO ${name} (user_id,${fields.join(',')}) VALUES ((SELECT id FROM owner),${fields.map((_,i)=>'?'+(i+2)).join(',')}) ON CONFLICT(user_id,id) DO NOTHING`).bind(...fields.map(k=>item[k]??null))];
 if(type==='class')statements.push(db.prepare(`${ownerSQL} UPDATE class_occurrences SET overridden=1,cancelled=0 WHERE user_id=(SELECT id FROM owner) AND (class_id=?2) `).bind(id),db.prepare(`${ownerSQL} UPDATE attendance_sessions SET confirmed_class=NULL,message='Class restored · waiting for automatic matching' WHERE user_id=(SELECT id FROM owner) AND (confirmed_class=?2 AND attempted IS NULL) `).bind(id));
 statements.push(db.prepare(`${ownerSQL} DELETE FROM user_settings WHERE user_id=(SELECT id FROM owner) AND (key=?2) `).bind(trashKey(type,id)));
 await db.batch(statements);return {ok:true};
}
