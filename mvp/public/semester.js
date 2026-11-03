let draft,route,preview,editVersion=0;
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const mytTime=s=>new Date(s).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false});
export function parseWeeks(value){
 if(!value.trim())return [];
 const numbers=[];
 for(const part of value.split(',')){
  const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
  if(!match)throw new Error('Write weeks as numbers or ranges, for example 1-6, 8, 10-14.');
  const start=Number(match[1]),end=Number(match[2]||match[1]);
  if(start<1||end>54||end<start)throw new Error('Week numbers must be between 1 and 54, with ranges in ascending order.');
  for(let week=start;week<=end;week++)numbers.push(week);
 }
 return [...new Set(numbers)].sort((a,b)=>a-b);
}
function row(){return {id:crypto.randomUUID(),course:'',name:'',kind:'Lecture',weekday:1,start:'',end:'',room:'',occ:'',weeksText:''};}
export function copyWeekRows(classes,courses,previous,dateKey){
 const used=new Set();
 return classes.map(c=>{
  const weekday=((new Date(dateKey(c.starts)+'T00:00:00Z').getUTCDay()+6)%7)+1,start=mytTime(c.starts),end=mytTime(c.ends);
  const candidates=previous.filter(s=>!used.has(s.id)&&s.course===c.course&&s.kind===c.kind&&s.weekday===weekday&&s.occ===(c.occ||''));
  const match=candidates.find(s=>s.start===start&&s.end===end)||(candidates.length===1?candidates[0]:null);
  if(match)used.add(match.id);
  return {...(match||row()),course:c.course,name:match?.name||courses.find(course=>course.code===c.course)?.name||c.course,kind:c.kind,weekday,start,end,room:c.room||'',occ:c.occ||''};
 });
}
function edit(definition){return {...structuredClone(definition),teachingText:definition.allWeeks?'':definition.teachingWeeks.join(', '),excludedText:definition.excludedDates.join('\n'),series:definition.series.map(s=>({...s,weeksText:s.weeks.join(', ')}))};}
function ensure(state){
 if(route===location.hash&&draft)return;
 route=location.hash;preview=null;
 const saved=state.semesters?.find(s=>s.id===route.split('/')[1]);
 draft=saved?edit(saved):{id:crypto.randomUUID(),revision:0,name:'',start:'',end:'',week1:'',teachingText:'',excludedText:'',series:[row()]};
}
function input(label,field,value,type='text',extra=''){return `<label>${label}<input data-field="${field}" type="${type}" value="${escape(value)}" ${extra}></label>`;}
export function semesterView(state){
 ensure(state);
 return `<section class="semester-editor"><a href="#timetable">← Back to timetable</a><div class="heading-row"><div><p class="eyebrow">PLAN THE SEMESTER</p><h1>${draft.revision?'Edit semester':'New semester'}</h1><p>Confirm the dates and weekly pattern, then review every change before saving.</p></div></div>
 <form id="semester-form"><section class="panel"><h2>Semester dates</h2><div class="semester-fields">
 ${input('Semester name','name',draft.name,'text','required maxlength="100"')}${input('Start date','start',draft.start,'date','required')}${input('End date','end',draft.end,'date','required')}${input('Week 1 Monday','week1',draft.week1,'date','required')}
 ${input('Teaching weeks (optional)','teachingText',draft.teachingText,'text','placeholder="Every week in this semester" aria-describedby="weeks-help"')}
 <label>Dates without classes<textarea data-field="excludedText" rows="3" placeholder="YYYY-MM-DD, one date per line">${escape(draft.excludedText)}</textarea></label></div><p class="subtle" id="weeks-help">Leave Teaching weeks blank to repeat every week within the semester dates. To skip breaks, enter specific weeks, such as 1-8, 10-15. Week numbers count from Week 1 Monday. Individual classes and the weekly pattern remain editable. All times are Malaysia time.</p></section>
 <section class="panel"><h2>Weekly classes</h2><p class="subtle">Each row is a weekly class. Leave its Weeks field empty to use all teaching weeks.</p>
 <div class="semester-copy"><label>Copy a saved week<input id="copy-week-date" type="date"></label><button type="button" id="copy-week">Use this week’s classes</button></div>
 <p class="subtle">Copying replaces the rows below. It proposes a weekly pattern; it does not save or repeat classes until you review and confirm.</p>
 <datalist id="semester-course-codes">${state.courses.map(c=>`<option value="${escape(c.code)}">${escape(c.name)}</option>`).join('')}</datalist>
 <div id="weekly-classes">${draft.series.map((s,i)=>`<fieldset data-series="${escape(s.id)}"><legend>Weekly class ${i+1}</legend><div class="semester-fields">
 ${input('Course code','course',s.course,'text','required maxlength="50" list="semester-course-codes"')}${input('Course name','name',s.name,'text','maxlength="180"')}
 <label>Activity<select data-field="kind">${['Lecture','Tutorial','Lab','Other'].map(k=>`<option ${s.kind===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <label>Weekday<select data-field="weekday">${weekdays.map((day,n)=>`<option value="${n+1}" ${s.weekday===n+1?'selected':''}>${day}</option>`).join('')}</select></label>
 ${input('Start time','start',s.start,'time','required')}${input('End time','end',s.end,'time','required')}${input('Room / meeting details','room',s.room,'text','maxlength="160"')}${input('OCC / group','occ',s.occ,'text','maxlength="30"')}${input('Weeks (optional)','weeksText',s.weeksText,'text','placeholder="All teaching weeks"')}
 </div><button class="quiet danger" type="button" data-remove-series="${escape(s.id)}">Remove weekly class ${i+1}</button></fieldset>`).join('')}</div>
 <button type="button" id="add-weekly-class">+ Add weekly class</button></section>
 <p id="semester-error" class="danger" role="alert" tabindex="-1"></p><p id="semester-message" role="status"></p>
 <div class="actions"><button class="primary" type="submit">Preview changes</button><button type="button" id="save-semester" disabled>Confirm and save</button><button type="button" id="export-semester">Export schedule</button><label class="semester-import">Import schedule JSON<input id="import-semester" type="file" accept="application/json,.json"></label></div>
 </form><section id="semester-preview" aria-live="polite"></section></section>`;
}
function capture(){
 const form=document.querySelector('#semester-form');
 for(const field of ['name','start','end','week1','teachingText','excludedText'])draft[field]=form.querySelector(`[data-field="${field}"]`).value;
 draft.series=[...form.querySelectorAll('[data-series]')].map(element=>{
  const s={id:element.dataset.series};for(const field of ['course','name','kind','weekday','start','end','room','occ','weeksText'])s[field]=element.querySelector(`[data-field="${field}"]`).value;
  s.weekday=Number(s.weekday);return s;
 });
}
function definition(){return {id:draft.id,revision:draft.revision,name:draft.name,start:draft.start,end:draft.end,week1:draft.week1,allWeeks:!draft.teachingText.trim(),teachingWeeks:parseWeeks(draft.teachingText),excludedDates:draft.excludedText.split(/[,\s]+/).filter(Boolean),series:draft.series.map(s=>({id:s.id,course:s.course,name:s.name||s.course,kind:s.kind,weekday:s.weekday,start:s.start,end:s.end,room:s.room,occ:s.occ,weeks:parseWeeks(s.weeksText)}))};}
function clearPreview(){editVersion++;preview=null;document.querySelector('#save-semester').disabled=true;document.querySelector('#semester-preview').innerHTML='';document.querySelector('#semester-message').textContent='';}
function error(e){const target=document.querySelector('#semester-error');if(target){target.textContent=e.message;target.focus();}}
function showPreview(result,fmt){
 const {counts,classes}=result;
 document.querySelector('#semester-preview').innerHTML=`<div class="panel"><h2>Review proposed changes</h2><p>${counts.added} added · ${counts.updated} updated · ${counts.removed} removed · ${counts.kept} kept · ${counts.cancelled} cancelled</p><p class="subtle">Individual edits and cancelled occurrences stay protected. Confirm these dates against your university timetable.</p><div class="semester-preview-scroll"><table><caption>Proposed dated classes, in Malaysia time</caption><thead><tr><th>Date</th><th>Course</th><th>Time</th><th>Room</th><th>Change</th></tr></thead><tbody>${classes.map(c=>`<tr><td>${escape(c.date)}</td><td>${escape(c.course)}<small>${escape(c.kind)} · OCC ${escape(c.occ||'—')}</small></td><td>${escape(fmt(c.starts,{hour:'2-digit',minute:'2-digit'}))}–${escape(fmt(c.ends,{hour:'2-digit',minute:'2-digit'}))}</td><td>${escape(c.room||'Not specified')}</td><td>${escape(c.status)}</td></tr>`).join('')}</tbody></table></div></div>`;
 document.querySelector('#save-semester').disabled=false;
 document.querySelector('#semester-message').textContent='Preview ready. Nothing has been saved yet.';
}
export function bindSemester(state,{api,load,render,toast,fmt,dateKey}){
 const form=document.querySelector('#semester-form');if(!form)return;
 form.addEventListener('input',()=>{capture();clearPreview();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();capture();clearPreview();document.querySelector('#semester-error').textContent='';
  const button=event.submitter||form.querySelector('[type="submit"]'),version=editVersion,currentRoute=location.hash;button.disabled=true;
  try{const result=await api('semester-preview',{definition:definition()});if(version===editVersion&&currentRoute===location.hash){preview=result;showPreview(preview,fmt);}}catch(e){error(e);}finally{button.disabled=false;}
 });
 document.querySelector('#add-weekly-class').onclick=()=>{capture();draft.series.push(row());preview=null;render();};
 document.querySelectorAll('[data-remove-series]').forEach(button=>button.onclick=()=>{capture();draft.series=draft.series.filter(s=>s.id!==button.dataset.removeSeries);preview=null;render();});
 document.querySelector('#copy-week').onclick=()=>{
  const value=document.querySelector('#copy-week-date').value;if(!value){error(new Error('Choose a saved week to copy.'));return;}
  const picked=new Date(value+'T00:00:00Z'),monday=+picked-((picked.getUTCDay()+6)%7)*86400000;
  const classes=state.classes.filter(c=>{const d=Date.parse(dateKey(c.starts)+'T00:00:00Z');return d>=monday&&d<monday+7*86400000;});
  if(!classes.length){error(new Error('There are no saved classes in that week.'));return;}
  if(!confirm('Replace the weekly rows with this saved week? You will review them before saving.'))return;
  capture();draft.series=copyWeekRows(classes,state.courses,draft.series,dateKey);
  preview=null;render();
 };
 document.querySelector('#save-semester').onclick=async event=>{
  if(!preview)return;const approved=preview;event.currentTarget.disabled=true;
  try{await api('semester-apply',{definition:approved.definition,token:approved.token});draft=null;route=null;preview=null;await load();location.hash='#semester/'+approved.definition.id;toast('Semester saved. Individual edits and cancellations were preserved.');}
  catch(e){clearPreview();error(e);}
 };
 document.querySelector('#export-semester').onclick=()=>{
  try{capture();const data=definition();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='better-spectrum-semester.json';a.click();URL.revokeObjectURL(url);}catch(e){error(e);}
 };
 document.querySelector('#import-semester').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try{
   if(file.size>24000)throw new Error('The schedule file must be smaller than 24 KB.');
   const data=JSON.parse(await file.text());data.revision=state.semesters?.find(s=>s.id===data.id)?.revision||0;
   const result=await api('semester-preview',{definition:data});draft=edit(result.definition);route='#semester/'+draft.id;location.hash=route;preview=null;render();
   document.querySelector('#semester-message').textContent='Schedule imported for review. Preview and confirm to save it.';
  }catch(e){error(new Error('Could not import the schedule: '+e.message));}
 };
}
