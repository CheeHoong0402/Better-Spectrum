import {digest} from './security.js';

const dayMs=86400000;
const idPattern=/^[\w-]{1,80}$/;
export class SemesterError extends Error {}
function fail(message){throw new SemesterError(message);}
function date(value,label){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail(`Enter a valid ${label}.`);
 return value;
}
function text(value,max,label,required=false){
 if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(`Enter a valid ${label}.`);
 return value.trim();
}
function weeks(value,label){
 if(!Array.isArray(value)||value.some(n=>!Number.isInteger(n)||n<1||n>54))fail(`Choose valid ${label} between 1 and 54.`);
 return [...new Set(value)].sort((a,b)=>a-b);
}
export function validateSemester(input){
 if(!input||typeof input.id!=='string'||!idPattern.test(input.id)||!Number.isInteger(input.revision)||input.revision<0)fail('Invalid semester identifier or revision.');
 const start=date(input.start,'semester start date'),end=date(input.end,'semester end date'),week1=date(input.week1,'week 1 Monday');
 if(end<start||Date.parse(end)-Date.parse(start)>370*dayMs)fail('The semester must end within one year of its start.');
 if(new Date(week1+'T00:00:00Z').getUTCDay()!==1||week1>start||Date.parse(start)-Date.parse(week1)>6*dayMs)fail('Week 1 must start on the Monday of the semester’s first week.');
 const lastWeek=Math.floor((Date.parse(end)-Date.parse(week1))/(7*dayMs))+1;
 if(input.allWeeks!==undefined&&typeof input.allWeeks!=='boolean')fail('Choose a valid weekly default.');
 const allWeeks=input.allWeeks===true||input.teachingWeeks===undefined||(Array.isArray(input.teachingWeeks)&&!input.teachingWeeks.length);
 const teachingWeeks=allWeeks?Array.from({length:lastWeek},(_,i)=>i+1):weeks(input.teachingWeeks,'teaching weeks');
 if(teachingWeeks.some(w=>w>lastWeek))fail('Teaching weeks must fall inside the semester.');
 if(!Array.isArray(input.excludedDates)||input.excludedDates.length>370)fail('Enter a valid list of excluded dates.');
 const excludedDates=[...new Set(input.excludedDates.map(d=>date(d,'excluded date')))].sort();
 if(excludedDates.some(d=>d<start||d>end))fail('Excluded dates must fall inside the semester.');
 if(!Array.isArray(input.series)||!input.series.length||input.series.length>40)fail('Add between 1 and 40 weekly classes.');
 const series=input.series.map(s=>{
  if(!s||typeof s.id!=='string'||!idPattern.test(s.id)||!Number.isInteger(s.weekday)||s.weekday<1||s.weekday>7)fail('Choose a valid weekly class and weekday.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.end)||s.end<=s.start)fail('Each class needs an end time after its start on the same day.');
  const chosen=weeks(s.weeks,'class weeks');if(chosen.some(w=>!teachingWeeks.includes(w)))fail('Class weeks must be selected teaching weeks.');
  return {id:s.id,course:text(s.course,50,'course code',true),name:text(s.name||s.course,180,'course name',true),kind:text(s.kind,30,'class activity',true),weekday:s.weekday,start:s.start,end:s.end,room:text(s.room||'',160,'room'),occ:text(s.occ||'',30,'occurrence'),weeks:chosen};
 });
 if(new Set(series.map(s=>s.id)).size!==series.length)fail('Weekly class identifiers must be unique.');
 return {id:input.id,revision:input.revision,name:text(input.name,100,'semester name',true),start,end,week1,allWeeks,teachingWeeks,excludedDates,series};
}

export function semesterClasses(definition){
 const rows=[];
 for(const s of definition.series)for(const w of s.weeks.length?s.weeks:definition.teachingWeeks){
  const d=new Date(Date.parse(definition.week1+'T00:00:00Z')+((w-1)*7+s.weekday-1)*dayMs).toISOString().slice(0,10);
  if(d<definition.start||d>definition.end||definition.excludedDates.includes(d))continue;
  rows.push({id:`semester:${definition.id}:${s.id}:${d}`,series_id:s.id,date:d,course:s.course,kind:s.kind,starts:new Date(`${d}T${s.start}:00+08:00`).toISOString(),ends:new Date(`${d}T${s.end}:00+08:00`).toISOString(),room:s.room,occ:s.occ,source:'Semester schedule',reminder_minutes:15});
 }
 if(rows.length>1000)fail('This semester generates more than 1,000 classes. Reduce the selected weeks or weekly classes.');
 const slots=new Set();for(const row of rows){const key=JSON.stringify([row.course,row.kind,row.occ,row.starts,row.ends]);if(slots.has(key))fail('Two weekly rows generate the same class. Remove the duplicate or choose different weeks.');slots.add(key);}
 return rows.sort((a,b)=>a.starts.localeCompare(b.starts)||a.id.localeCompare(b.id));
}
const instant=s=>new Date(s).toISOString();
const sameSlot=(a,b)=>a.course===b.course&&a.kind===b.kind&&a.occ===b.occ&&instant(a.starts)===instant(b.starts)&&instant(a.ends)===instant(b.ends);
const sameClass=(a,b)=>sameSlot(a,b)&&a.room===b.room&&a.source===b.source&&a.reminder_minutes===b.reminder_minutes;
export function planSemester(definition,classes,occurrences){
 const generated=semesterClasses(definition),writes=[],links=[],remove=[],preview=[],counts={added:0,updated:0,kept:0,cancelled:0,removed:0};
 const allLinked=new Set(occurrences.map(o=>o.class_id)),claimed=new Set(allLinked);
 const own=occurrences.filter(o=>o.semester_id===definition.id),bySlot=new Map(own.map(o=>[`${o.series_id}:${o.date}`,o]));
 const active=new Set();
 for(const row of generated){
  const key=`${row.series_id}:${row.date}`;active.add(key);
  const link=bySlot.get(key),existing=link&&classes.find(c=>c.id===link.class_id);
  let status;
  if(link?.cancelled){status='cancelled';}
  else if(link?.overridden&&existing){status='kept';preview.push({...existing,date:row.date,status});counts[status]++;continue;}
  else{
   const adopt=!link&&classes.find(c=>!claimed.has(c.id)&&sameSlot(c,row));
   const id=link?.class_id||adopt?.id||row.id;claimed.add(id);
   links.push({class_id:id,semester_id:definition.id,series_id:row.series_id,date:row.date,overridden:adopt?1:0});
   if(adopt){status='kept';preview.push({...adopt,date:row.date,status});counts[status]++;continue;}
   const current=existing||classes.find(c=>c.id===id);
   status=current?(sameClass(current,row)?'kept':'updated'):'added';
   if(status!=='kept')writes.push({...row,id});
  }
  counts[status]++;preview.push({...row,id:link?.class_id||row.id,status});
 }
 for(const link of own)if(!active.has(`${link.series_id}:${link.date}`)){
  const existing=classes.find(c=>c.id===link.class_id);
  if(link.cancelled){counts.cancelled++;continue;}
  if(link.overridden&&existing){counts.kept++;preview.push({...existing,date:link.date,status:'kept'});}
  else{remove.push(link.class_id);counts.removed++;if(existing)preview.push({...existing,date:link.date,status:'removed'});}
 }
 return {writes,links,remove,preview,counts};
}

async function snapshot(db,input){
 const definition=validateSemester(input);
 const [semester,classes,links]=await Promise.all([db.prepare('SELECT * FROM semesters WHERE id=?').bind(definition.id).first(),db.prepare('SELECT * FROM classes ORDER BY id').all(),db.prepare('SELECT * FROM class_occurrences ORDER BY class_id').all()]);
 if((semester?.revision||0)!==definition.revision)fail('This semester changed. Reopen it before saving.');
 const plan=planSemester(definition,classes.results,links.results);
 const token=await digest(JSON.stringify({definition,classes:classes.results,links:links.results}));
 return {definition,plan,token};
}
export async function previewSemester(db,input){
 const {definition,plan,token}=await snapshot(db,input);
 return {definition,token,counts:plan.counts,classes:plan.preview};
}
export async function applySemester(db,input,token){
 const saved=await snapshot(db,input);
 if(token!==saved.token)fail('Your timetable changed after the preview. Preview it again before saving.');
 const {definition:d,plan}=saved;
 const changed=JSON.stringify([...plan.remove,...plan.writes.map(c=>c.id)]);
 const statements=[db.prepare('INSERT INTO semesters (id,definition,revision) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,revision=CASE WHEN semesters.revision=? THEN excluded.revision ELSE NULL END').bind(d.id,JSON.stringify(d),d.revision+1,d.revision)];
 statements.push(db.prepare("DELETE FROM deliveries WHERE sent IS NULL AND EXISTS (SELECT 1 FROM json_each(?) changed WHERE substr(deliveries.id,1,length(changed.value)+7)='class:'||changed.value||':')").bind(changed));
 statements.push(db.prepare('DELETE FROM classes WHERE id IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM class_occurrences o WHERE o.class_id=classes.id AND o.overridden=0 AND o.cancelled=0)').bind(JSON.stringify(plan.remove)));
 statements.push(db.prepare('DELETE FROM class_occurrences WHERE class_id IN (SELECT value FROM json_each(?)) AND overridden=0 AND cancelled=0').bind(JSON.stringify(plan.remove)));
 statements.push(db.prepare(`INSERT INTO classes (id,course,kind,starts,ends,room,occ,source,reminder_minutes)
 SELECT json_extract(j.value,'$.id'),json_extract(j.value,'$.course'),json_extract(j.value,'$.kind'),json_extract(j.value,'$.starts'),json_extract(j.value,'$.ends'),json_extract(j.value,'$.room'),json_extract(j.value,'$.occ'),json_extract(j.value,'$.source'),json_extract(j.value,'$.reminder_minutes') FROM json_each(?) j
 WHERE NOT EXISTS (SELECT 1 FROM class_occurrences o WHERE o.class_id=json_extract(j.value,'$.id') AND (o.overridden=1 OR o.cancelled=1))
 ON CONFLICT(id) DO UPDATE SET course=excluded.course,kind=excluded.kind,starts=excluded.starts,ends=excluded.ends,room=excluded.room,occ=excluded.occ,source=excluded.source,reminder_minutes=excluded.reminder_minutes`).bind(JSON.stringify(plan.writes)));
 statements.push(db.prepare(`INSERT INTO class_occurrences (class_id,semester_id,series_id,date,overridden)
 SELECT json_extract(value,'$.class_id'),json_extract(value,'$.semester_id'),json_extract(value,'$.series_id'),json_extract(value,'$.date'),json_extract(value,'$.overridden') FROM json_each(?) WHERE 1
 ON CONFLICT(class_id) DO NOTHING`).bind(JSON.stringify(plan.links)));
 const catalog=[...new Map(d.series.map(s=>[s.course,{code:s.course,name:s.name}])).values()];
 statements.push(db.prepare(`INSERT INTO settings (key,value) VALUES ('course_catalog',?) ON CONFLICT(key) DO UPDATE SET value=(
 SELECT json_group_array(json(entry.value)) FROM (
 SELECT value FROM json_each(settings.value) UNION ALL
 SELECT fresh.value FROM json_each(excluded.value) fresh WHERE NOT EXISTS (SELECT 1 FROM json_each(settings.value) old WHERE json_extract(old.value,'$.code')=json_extract(fresh.value,'$.code'))
 ) entry)`).bind(JSON.stringify(catalog)));
 await db.batch(statements);
 return {ok:true,counts:plan.counts};
}
