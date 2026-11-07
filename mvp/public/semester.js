import {readDraft,writeDraft,deleteDraft} from './drafts.js';
let draft,route,preview,editVersion=0,saving=false;
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
 draft=readDraft('semester:'+route)||(saved?edit(saved):{id:crypto.randomUUID(),revision:0,name:'',start:'',end:'',week1:'',teachingText:'',excludedText:'',series:[row()]});
}
export function resetSemesterDraft(){draft=null;route=null;preview=null;}
function remember(){writeDraft('semester:'+route,draft);}
function input(label,field,value,type='text',extra=''){return `<label>${label}<input data-field="${field}" type="${type}" value="${escape(value)}" ${extra}></label>`;}
export function semesterView(state){
 ensure(state);
 const latest=state.semesters?.find(s=>s.id===draft.id),conflict=latest&&latest.revision>draft.revision;
 return `<section class="semester-editor"><a href="#timetable">← Back to timetable</a><div class="heading-row"><div><h1 tabindex="-1">${draft.revision?'Edit semester':'New semester'}</h1></div></div>
 <p class="subtle">Unfinished changes stay in this browser tab through refreshes until you save, discard, or sign out.</p><form id="semester-form"><fieldset id="semester-fields"${saving?' disabled':''}>${conflict?'<div class="notice" role="alert"><p>This semester changed since you started this draft. Choose which version to review.</p><button type="button" id="reload-semester">Use saved version (discard draft)</button><button type="button" id="reapply-semester">Keep my draft for review</button></div>':''}<section class="panel" id="semester-dates"><h2>Semester dates</h2><div class="semester-fields">
 ${input('Semester name','name',draft.name,'text','required maxlength="100"')}${input('Start date','start',draft.start,'date','required')}${input('End date','end',draft.end,'date','required')}${input('Week 1 Monday','week1',draft.week1,'date','required')}
 </div><details class="exceptions"><summary>Teaching weeks and dates without classes</summary><div class="semester-fields">
 ${input('Teaching weeks (optional)','teachingText',draft.teachingText,'text','placeholder="Every week in this semester" aria-describedby="weeks-help"')}
 <label>Dates without classes<textarea data-field="excludedText" rows="3" placeholder="YYYY-MM-DD, one date per line">${escape(draft.excludedText)}</textarea></label></div><p class="subtle" id="weeks-help">Leave Teaching weeks blank to repeat every week within the semester dates. To skip breaks, enter specific weeks, such as 1-8, 10-15. Week numbers count from Week 1 Monday. Individual classes and the weekly pattern remain editable. All times are Malaysia time.</p></details></section>
 <section class="panel" id="semester-classes"><h2>Weekly classes <span class="subtle">${draft.series.length}</span></h2><p class="subtle">Each row is a weekly class. Leave its Weeks field empty to use all teaching weeks.</p>
 <div class="semester-copy"><label>Copy a saved week<input id="copy-week-date" type="date"></label><button type="button" id="copy-week">Use this week’s classes</button></div>
 <p class="subtle">Copying replaces the rows below. It proposes a weekly pattern; it does not save or repeat classes until you review and confirm.</p>
 <datalist id="semester-course-codes">${state.courses.map(c=>`<option value="${escape(c.code)}">${escape(c.name)}</option>`).join('')}</datalist>
 <div id="weekly-classes">${draft.series.map((s,i)=>`<details class="weekly-class" data-series="${escape(s.id)}"${!s.course||!s.start||!s.end?' open':''}><summary><strong>${escape(s.name||s.course||'Weekly class '+(i+1))}</strong><small>${escape(weekdays[s.weekday-1]||'Choose a day')} · ${escape(s.start||'Start')}–${escape(s.end||'End')} · ${escape(s.kind)}</small></summary><fieldset><legend class="sr-only">Weekly class ${i+1}</legend><div class="semester-fields">
 ${input('Course code','course',s.course,'text','required maxlength="50" list="semester-course-codes"')}${input('Course name','name',s.name,'text','maxlength="180"')}
 <label>Activity<select data-field="kind">${['Lecture','Tutorial','Lab','Other'].map(k=>`<option ${s.kind===k?'selected':''}>${k}</option>`).join('')}</select></label>
 <label>Weekday<select data-field="weekday">${weekdays.map((day,n)=>`<option value="${n+1}" ${s.weekday===n+1?'selected':''}>${day}</option>`).join('')}</select></label>
 ${input('Start time','start',s.start,'time','required')}${input('End time','end',s.end,'time','required')}${input('Room / meeting details','room',s.room,'text','maxlength="160"')}${input('OCC / group','occ',s.occ,'text','maxlength="30"')}${input('Weeks (optional)','weeksText',s.weeksText,'text','placeholder="All teaching weeks"')}
 </div><button class="quiet danger" type="button" data-remove-series="${escape(s.id)}">Remove weekly class ${i+1}</button></fieldset></details>`).join('')}</div>
 <button type="button" id="add-weekly-class">+ Add weekly class</button>${draft.removedRows?.length?'<button type="button" id="undo-weekly-class">Undo weekly row removal</button>':''}</section>
 <p id="semester-error" class="danger" role="alert" tabindex="-1"></p><p id="semester-message" role="status">${saving?'Saving your semester…':''}</p>
 <details class="semester-tools"><summary>Import and export</summary><div class="actions"><button type="button" id="export-semester">Export schedule</button><label class="semester-import">Import schedule JSON<input id="import-semester" type="file" accept="application/json,.json"></label></div></details><section id="semester-preview" aria-live="polite"></section><div class="semester-action-bar"><button type="button" id="discard-semester" class="quiet danger">Discard draft</button><button id="preview-semester" class="primary" type="submit" ${conflict?'disabled':''}>Preview changes</button><button type="button" id="save-semester" disabled hidden>Confirm and save</button></div>
 </fieldset></form></section>`;
}
function capture(){
 const form=document.querySelector('#semester-form');
 for(const field of ['name','start','end','week1','teachingText','excludedText'])draft[field]=form.querySelector(`[data-field="${field}"]`).value;
 draft.series=[...form.querySelectorAll('[data-series]')].map(element=>{
  const s={id:element.dataset.series};for(const field of ['course','name','kind','weekday','start','end','room','occ','weeksText'])s[field]=element.querySelector(`[data-field="${field}"]`).value;
  s.weekday=Number(s.weekday);return s;
 });remember();
}
function definition(){return {id:draft.id,revision:draft.revision,name:draft.name,start:draft.start,end:draft.end,week1:draft.week1,allWeeks:!draft.teachingText.trim(),teachingWeeks:parseWeeks(draft.teachingText),excludedDates:draft.excludedText.split(/[,\s]+/).filter(Boolean),series:draft.series.map(s=>({id:s.id,course:s.course,name:s.name||s.course,kind:s.kind,weekday:s.weekday,start:s.start,end:s.end,room:s.room,occ:s.occ,weeks:parseWeeks(s.weeksText)}))};}
function clearPreview(){editVersion++;preview=null;document.querySelector('#save-semester').disabled=true;document.querySelector('#save-semester').hidden=true;document.querySelector('#preview-semester').className='primary';document.querySelector('#semester-preview').innerHTML='';document.querySelector('#semester-message').textContent='';}
function error(e){const target=document.querySelector('#semester-error');if(target){document.querySelector('#semester-message').textContent='';target.textContent=e.message;target.focus();}}
function showPreview(result,fmt){
 const {counts,classes}=result;
 document.querySelector('#semester-preview').innerHTML=`<div class="panel"><h2 tabindex="-1">Review proposed changes</h2><p>${counts.added} added · ${counts.updated} updated · ${counts.removed} removed · ${counts.kept} kept · ${counts.cancelled} cancelled</p><p class="subtle">Individual edits and cancelled occurrences stay protected. Confirm these dates against your university timetable.</p><div class="semester-preview-scroll"><table><caption>Proposed dated classes, in Malaysia time</caption><thead><tr><th>Date</th><th>Course</th><th>Time</th><th>Room</th><th>Change</th></tr></thead><tbody>${classes.map(c=>`<tr><td>${escape(c.date)}</td><td>${escape(c.course)}<small>${escape(c.kind)} · OCC ${escape(c.occ||'—')}</small></td><td>${escape(fmt(c.starts,{hour:'2-digit',minute:'2-digit'}))}–${escape(fmt(c.ends,{hour:'2-digit',minute:'2-digit'}))}</td><td>${escape(c.room||'Not specified')}</td><td>${escape(c.status)}</td></tr>`).join('')}</tbody></table></div></div>`;
 document.querySelector('#save-semester').disabled=false;document.querySelector('#save-semester').hidden=false;document.querySelector('#save-semester').className='primary';document.querySelector('#preview-semester').className='quiet';document.querySelector('#semester-preview h2')?.focus();
 document.querySelector('#semester-message').textContent='Preview ready. Nothing has been saved yet.';
}
export function bindSemester(state,{api,load,render,toast,fmt,dateKey}){
 const form=document.querySelector('#semester-form');if(!form)return;
 form.addEventListener('invalid',event=>{let detail=event.target.closest('details');while(detail){detail.open=true;detail=detail.parentElement?.closest('details');}event.target.focus();},true);
 document.querySelector('#reload-semester')?.addEventListener('click',()=>{deleteDraft('semester:'+route);resetSemesterDraft();render();});
 document.querySelector('#reapply-semester')?.addEventListener('click',()=>{capture();const latest=state.semesters.find(s=>s.id===draft.id);if(!latest)return;draft.revision=latest.revision;clearPreview();remember();render();});
 form.addEventListener('input',()=>{capture();clearPreview();for(const element of document.querySelectorAll('[data-series]')){const item=draft.series.find(s=>s.id===element.dataset.series);const title=element.querySelector('summary strong'),description=element.querySelector('summary small');if(title)title.textContent=item.name||item.course||'New weekly class';if(description)description.textContent=(weekdays[item.weekday-1]||'Choose a day')+' · '+(item.start||'Start')+'–'+(item.end||'End')+' · '+item.kind;}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;capture();clearPreview();document.querySelector('#semester-error').textContent='';
  const button=event.submitter||form.querySelector('[type="submit"]'),version=editVersion,currentRoute=location.hash;button.disabled=true;button.textContent='Preparing preview…';document.querySelector('#semester-message').textContent='Checking your proposed classes…';
  try{const result=await api('semester-preview',{definition:definition()});if(version===editVersion&&currentRoute===location.hash){preview=result;showPreview(preview,fmt);}}catch(e){error(e);if(e.status===409)await load();}finally{button.disabled=false;button.textContent='Preview changes';}
 });
 document.querySelector('#add-weekly-class').onclick=()=>{capture();draft.series.push(row());clearPreview();remember();render();const added=[...document.querySelectorAll('[data-series]')].at(-1);if(added){added.open=true;added.querySelector('input')?.focus();}};
 document.querySelectorAll('[data-remove-series]').forEach(button=>button.onclick=()=>{capture();const index=draft.series.findIndex(s=>s.id===button.dataset.removeSeries);(draft.removedRows||=[]).push({index,row:draft.series[index]});draft.series.splice(index,1);clearPreview();remember();render();document.querySelector('#undo-weekly-class')?.focus();});
 document.querySelector('#undo-weekly-class')?.addEventListener('click',()=>{capture();const removed=draft.removedRows.pop();draft.series.splice(Math.min(removed.index,draft.series.length),0,removed.row);clearPreview();remember();render();const restored=[...document.querySelectorAll('[data-series]')].find(e=>e.dataset.series===removed.row.id);if(restored){restored.open=true;restored.querySelector('input')?.focus();}});
 document.querySelector('#discard-semester').onclick=()=>{if(confirm('Discard this semester draft? Your saved timetable will stay unchanged.')){deleteDraft('semester:'+route);resetSemesterDraft();render();}};
 document.querySelector('#copy-week').onclick=()=>{
  const value=document.querySelector('#copy-week-date').value;if(!value){error(new Error('Choose a saved week to copy.'));return;}
  const picked=new Date(value+'T00:00:00Z'),monday=+picked-((picked.getUTCDay()+6)%7)*86400000;
  const classes=state.classes.filter(c=>{const d=Date.parse(dateKey(c.starts)+'T00:00:00Z');return d>=monday&&d<monday+7*86400000;});
  if(!classes.length){error(new Error('There are no saved classes in that week.'));return;}
  if(!confirm('Replace the weekly rows with this saved week? You will review them before saving.'))return;
  capture();draft.series=copyWeekRows(classes,state.courses,draft.series,dateKey);
  clearPreview();remember();render();
 };
 document.querySelector('#save-semester').onclick=async event=>{
  if(saving||!preview)return;saving=true;const approved=preview,savedRoute=route;event.currentTarget.disabled=true;event.currentTarget.textContent='Saving semester…';document.querySelector('#semester-fields').disabled=true;document.querySelector('#semester-message').textContent='Saving your semester…';
  try{
   await api('semester-apply',{definition:approved.definition,token:approved.token});deleteDraft('semester:'+savedRoute);
   if(route===savedRoute){draft=edit({...approved.definition,revision:approved.definition.revision+1});preview=null;editVersion++;}
   const refreshed=await load(true);
   if(location.hash===savedRoute&&route===savedRoute){route='#semester/'+approved.definition.id;location.hash=route;render();}
   if(refreshed)toast('Semester saved. Individual edits and cancellations were preserved.');
  }
  catch(e){if(location.hash===savedRoute&&route===savedRoute){clearPreview();error(e);}if(e.status===409)await load();}
  finally{saving=false;const fields=document.querySelector('#semester-fields');if(fields){fields.disabled=false;document.querySelector('#semester-message').textContent='';}event.target.textContent='Confirm and save';}
 };
 document.querySelector('#export-semester').onclick=()=>{
  try{capture();const data=definition();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='better-spectrum-semester.json';a.click();URL.revokeObjectURL(url);}catch(e){error(e);}
 };
 document.querySelector('#import-semester').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;const currentRoute=location.hash;event.target.disabled=true;document.querySelector('#semester-message').textContent='Reading and checking your schedule…';
  try{
   if(file.size>24000)throw new Error('The schedule file must be smaller than 24 KB.');
   const data=JSON.parse(await file.text());data.revision=state.semesters?.find(s=>s.id===data.id)?.revision||0;
   const result=await api('semester-preview',{definition:data});if(currentRoute!==location.hash)return;draft=edit(result.definition);route='#semester/'+draft.id;location.hash=route;preview=null;remember();render();
   document.querySelector('#semester-message').textContent='Schedule imported for review. Preview and confirm to save it.';
  }catch(e){if(currentRoute===location.hash)error(new Error('Could not import the schedule: '+e.message));}
  finally{event.target.disabled=false;}
 };
}
