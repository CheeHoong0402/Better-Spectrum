import {plainText,courseLabel,pendingTask,taskGroup,orderedTasks} from './presentation.js';
import {notificationPanel,notificationSwitch,bindNotifications} from './notifications.js';
import {attendanceSwitch,attendanceConnection,bindAttendance} from './attendance.js';
import {semesterView,bindSemester,resetSemesterDraft} from './semester.js';
import {timetableView,applyTimetableLayout,updateTimetableClock,semesterForDate,weekLayout} from './timetable.js';
import {readDraft,writeDraft,deleteDraft,clearDrafts,draftsNeedWarning} from './drafts.js';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,week=0,filter='all',taskFilter='active',updateFilter='material',timetableMode='auto',busy=false;
let agendaDay,timetableDay,pendingAdd,saving=false,editorKey,removal;
const fmt=(d,opts={})=>new Date(d).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',...opts});
const time=d=>fmt(d,{hour:'2-digit',minute:'2-digit',hour12:false});
const day=d=>fmt(d,{weekday:'short',day:'numeric',month:'short'});
const dateKey=d=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(d));return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');};
const icon=n=>`<svg aria-hidden="true"><use href="#${n}"/></svg>`;
function color(code){return state.courses.find(c=>c.code===code)?.color||'#4263b5';}
function label(code){return courseLabel(code,state.courses.find(c=>c.code===code)?.name||code);}
function external(url,text){try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='spectrum.um.edu.my'?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>`:'';}catch{return '';}}
function toast(s,undo){$('#toast').textContent=s;if(undo){const button=document.createElement('button');button.textContent='Undo';button.onclick=()=>action(undo,button,'Restoring…',true);$('#toast').append(button);}$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,undo?12000:6500);}
function removedView(type){const rows=(state.removed||[]).filter(r=>r.type===type);return rows.length?`<details class="panel removed-records"><summary>Removed ${type==='task'?'deadlines':'and cancelled classes'} (${rows.length})</summary>${rows.map(({item})=>`<div class="removed-row"><span>${esc(item.course)} · ${esc(item.title||item.kind)}<small>${esc(day(item.due||item.starts))} · ${time(item.due||item.starts)}</small></span><button data-restore-type="${type}" data-restore-id="${esc(item.id)}">Restore</button></div>`).join('')}</details>`:'';}
async function restore(type,id){await api('restore',{type,id});if(await load())toast('Restored to your planner.');}
function remove(type,id){
 removal={type,id};$('#details').close();$('#remove-message').textContent=type==='class'?'Remove or cancel this class? You can restore it from Timetable.':'Remove this deadline? You can restore it from Deadlines.';$('#remove-record').showModal();
}

function captureEditor(){if(editorKey)writeDraft(editorKey,Object.fromEntries(new FormData($('#editor-form'))));}
function editorConflict(){
 const form=$('#editor-form'),item=state?.tasks.find(t=>t.id===form.elements.id.value);
 const fields=t=>JSON.stringify([t.course,t.title,t.due,t.reminder_minutes]);
 const conflict=form.elements.edit.value==='yes'&&item&&fields(item)!==fields(JSON.parse(form.elements.original.value||'{}'));
 $('#editor-conflict').hidden=!conflict;$('#save-editor').disabled=!!conflict;return conflict;
}
async function api(path,data){
 let r;try{r=await fetch('/api/'+path,{...(data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}),signal:['state','tasks','task-update','classes','push-status','deliveries'].includes(path)?AbortSignal.timeout(30000):undefined});}catch{throw new Error('Could not reach your planner. Check your connection and try again.');}
 let v;try{v=await r.json();}catch{throw new Error('Your planner returned an unexpected response. Please try again.');}
 if(!r.ok){
  if(r.status===401){state=null;$('#app').hidden=true;$('#load-status').hidden=true;$('#login').hidden=false;$('#login-error').textContent=v.error||'Sign in to continue.';for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();}
  throw Object.assign(new Error(v.error||'The request failed. Please try again.'),{status:r.status});
 }return v;
}
async function load(saved=false){
 const retry=$('#retry-load');retry.disabled=true;
 try{state=await api('state');$('#login').hidden=true;$('#app').hidden=false;$('#load-status').hidden=true;render();
  if(pendingAdd&&state.courses.length){const type=pendingAdd;pendingAdd=null;$('#course-setup').close();editor(type);}
  if($('#editor').open)editorConflict();return true;
 }catch(e){
  if(e.status!==401){$('#load-status').hidden=false;$('#load-title').textContent=state?'Your records may be out of date':navigator.onLine===false?'You’re offline':'Couldn’t open your planner';$('#load-message').textContent=(saved?'Saved to your planner, but the screen could not refresh. ':state?'Showing your last loaded records. ':'Your saved records are kept in your private planner. ')+e.message;retry.hidden=false;}
  return false;
 }finally{retry.disabled=false;}
}
function status(t){return t.status==='submitted'?'Submitted':t.status==='done'?'Completed':t.status==='draft'?'Draft · not submitted':t.status==='unknown'?'Submission unverified':taskGroup(t)==='unverified'?'Due date unverified':taskGroup(t)==='overdue'?'Overdue':'Upcoming';}
const active=pendingTask;
function taskCard(t){return `<article class="task"><div class="task-meta"><span><span class="course-dot" data-color="${esc(t.course)}"></span>${esc(t.course)}</span><span class="${status(t)==='Overdue'?'danger':''}">${esc(status(t))}</span></div><div class="task-title">${esc(plainText(t.title))}</div><div class="task-meta"><span>${esc(day(t.due))} · ${time(t.due)}</span><span>${esc(t.source)}</span></div><div class="task-actions">${external(t.url,'Open assignment')}${t.source==='manual'?`<button class="quiet" data-edit-task="${esc(t.id)}">Edit</button><button class="quiet" data-complete="${esc(t.id)}">${active(t)?'Mark done':'Reopen'}</button><button class="quiet danger" data-delete-task="${esc(t.id)}">Remove</button>`:''}</div></article>`;}
function heading(title,action=''){return `<div class="heading-row"><h1 tabindex="-1">${title}</h1>${action}</div>`;}
function taskSections(rows,limit=Infinity){
 const groups=[['overdue','Overdue'],['upcoming','Upcoming'],['unverified','Due date unverified'],['completed','Completed / submitted']];
 return groups.map(([key,title])=>{const items=orderedTasks(rows.filter(t=>taskGroup(t)===key));return items.length?`<section class="panel task-group-${key}"><div class="task-group-heading"><h2>${title}</h2><span class="badge" aria-label="${items.length} ${title.toLowerCase()}">${items.length}</span></div>${items.slice(0,limit).map(taskCard).join('')}</section>`:'';}).join('');
}
function today(){
 agendaDay ||= dateKey(new Date());
 const now=Date.now(),current=dateKey(now),selected=new Date(agendaDay+'T12:00:00+08:00'),weekday=(selected.getUTCDay()+6)%7;
 const dates=Array.from({length:7},(_,i)=>new Date(+selected+(i-weekday)*86400000));
 const classes=state.classes.filter(c=>dateKey(c.starts)===agendaDay).sort((a,b)=>Date.parse(a.starts)-Date.parse(b.starts));
 const next=agendaDay<current?null:(agendaDay===current?[...state.classes].filter(c=>Date.parse(c.ends)>now).sort((a,b)=>Date.parse(a.starts)-Date.parse(b.starts)):classes)[0];
 const nextToday=next&&dateKey(next.starts)===agendaDay;
 const entries=[...classes.filter(c=>!nextToday||c.id!==next.id).map(item=>({type:'class',item,at:item.starts})),...state.tasks.filter(t=>Number.isFinite(Date.parse(t.due))&&dateKey(t.due)===agendaDay).map(item=>({type:'task',item,at:item.due}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 const pending=state.tasks.filter(active),unread=state.updates.filter(u=>!u.seen).length;
 return `<div class="agenda-heading"><div><h1 tabindex="-1">Today</h1><p class="subtle">${esc(fmt(selected,{weekday:'long',day:'numeric',month:'long'}))}</p></div><details class="add-menu"><summary class="primary">+ Add</summary><div><button data-add="class">Class</button><button data-add="task">Deadline</button></div></details></div>
 <div class="date-navigation"><button class="quiet" data-shift-day="-7" aria-label="Previous week">�</button><div class="date-strip" aria-label="Choose a day">${dates.map(d=>`<button data-day="${dateKey(d)}" class="date-choice ${dateKey(d)===agendaDay?'selected':''}" aria-pressed="${dateKey(d)===agendaDay}" ${dateKey(d)===current?'aria-label="Today, '+esc(day(d))+'"':''}><small>${fmt(d,{weekday:'short'})}</small><span>${fmt(d,{day:'numeric'})}</span></button>`).join('')}</div><button class="quiet" data-shift-day="7" aria-label="Next week">�</button></div>
 ${next?`<button class="next-class" data-detail-type="class" data-detail-id="${esc(next.id)}"><small>${Date.parse(next.starts)<=now?'In progress':'Next class'}${nextToday?'':' � '+esc(day(next.starts))}</small><strong>${esc(label(next.course))}</strong><time>${time(next.starts)}�${time(next.ends)}</time><p>${esc(next.course)} � ${esc(next.kind)}</p><p>${esc(next.room||'Room not specified')}</p></button>`:''}
 <div class="agenda-layout"><div><div class="agenda-toolbar"><h2>${nextToday?'Later today':'Daily agenda'}</h2><button class="quiet" id="agenda-today">Today</button></div><section class="agenda-list" aria-label="Daily agenda">${entries.map(({type,item,at})=>`<button class="agenda-item ${type==='task'&&!active(item)?'is-complete':''}" data-detail-type="${type}" data-detail-id="${esc(item.id)}"><time>${time(at)}${type==='class'?'<small>'+time(item.ends)+'</small>':''}</time><span class="agenda-item-copy" data-border="${esc(item.course)}"><strong>${esc(type==='class'?label(item.course):plainText(item.title))}</strong><small>${esc(item.course)} � ${esc(type==='class'?item.kind:status(item))}</small>${type==='class'?`<small>${esc(item.room||'Room not specified')}</small>`:''}</span></button>`).join('')||`<div class="agenda-empty"><h2>${nextToday?'Nothing else scheduled':'No classes or deadlines'}</h2><p>${nextToday?'Your remaining schedule is clear.':'No saved items for this day.'}</p></div>`}</section></div>
 <aside class="agenda-aside"><div class="panel-heading"><h2>Deadlines</h2><a href="#tasks">View all</a></div>${taskSections(pending,2)||'<div class="panel"><p class="empty">No pending deadlines.</p></div>'}<a class="panel reminder-link" href="#updates"><span>Course updates</span><span class="badge">${unread} unread</span></a></aside></div>`;
}
function showDetail(type,id){
 const item=(type==='class'?state.classes:state.tasks).find(i=>i.id===id);if(!item)return;
 const d=$('#details');$('#detail-content').innerHTML=`<p class="eyebrow">${esc(type==='class'?item.course+' · '+item.kind:status(item))}</p><h2>${esc(type==='class'?label(item.course):plainText(item.title))}</h2><p class="detail-date">${esc(day(type==='class'?item.starts:item.due))} · ${time(type==='class'?item.starts:item.due)}${type==='class'?'–'+time(item.ends):''}</p><div class="detail-facts">${type==='class'?`<p><span>Location</span><strong>${esc(item.room||'Room not specified')}</strong></p><p><span>Group</span><strong>OCC ${esc(item.occ||'—')}</strong></p>`:`<p><span>Course</span><strong>${esc(item.course)}</strong></p>`}<p><span>Source</span><strong>${esc(item.source)}</strong></p></div><div class="detail-actions">${type==='class'?`<button id="detail-edit">Edit this class</button>${item.semester_id?`<a href="#semester/${esc(item.semester_id)}" id="detail-series">Edit weekly pattern</a>`:''}`:item.source==='manual'?`<button id="detail-edit-task">Edit deadline</button><button id="detail-done">${active(item)?'Mark done':'Reopen'}</button>`:external(item.url,'Open assignment')}<button class="danger" id="detail-remove" ${type==='task'&&item.source!=='manual'?'hidden':''}>${type==='class'&&item.semester_id?'Cancel this class':'Remove'}</button></div>`;
 $('#detail-series')?.addEventListener('click',()=>d.close());
 $('#detail-edit')?.addEventListener('click',()=>{d.close();editor('class',id);});
 $('#detail-edit-task')?.addEventListener('click',()=>{d.close();editor('task',id);});
 $('#detail-done')?.addEventListener('click',()=>action(async()=>{await api('task-status',{id,done:active(item)});d.close();await load();}));
 $('#detail-remove')?.addEventListener('click',()=>remove(type,id));d.showModal();
}
function timetable(){
 const today=dateKey(new Date()),first=weekLayout(state.classes,today,week,filter).days[0].stamp;
 const dates=Array.from({length:7},(_,i)=>dateKey(first+i*86400000));
 timetableDay=dates.includes(timetableDay)?timetableDay:dates.includes(today)?today:dates[0];
 return timetableView(state,{today,week,filter,selectedDay:timetableDay,mode:timetableMode,esc,fmt,time,day,courseSelect})+removedView('class');
}
function courseSelect(){return `<label><span>Filter by course</span><select id="course-filter"><option value="all">All courses</option>${state.courses.map(c=>`<option value="${esc(c.code)}" ${filter===c.code?'selected':''}>${esc(c.code)}</option>`).join('')}</select></label>`;}
function tasks(){const rows=state.tasks.filter(t=>(filter==='all'||t.course===filter)&&(taskFilter==='all'||(taskFilter==='active'?active(t):!active(t))));return heading('Deadlines',`<button class="primary" data-add="task">+ Add deadline</button>`)+`<div class="filter-row">${courseSelect()}<label>Show<select id="task-filter"><option value="active" ${taskFilter==='active'?'selected':''}>Pending</option><option value="completed" ${taskFilter==='completed'?'selected':''}>Completed / submitted</option><option value="all" ${taskFilter==='all'?'selected':''}>All deadlines</option></select></label></div><section class="panel">${rows.map(taskCard).join('')||deadlineEmpty()}</section><p class="subtle">SPeCTRUM submissions are confirmed by the university system. Manual tasks can be marked done here.</p>`+removedView('task');}
function updates(){
 const rows=state.updates.filter(u=>filter==='all'||u.course===filter);
 const categories=[['material','Materials'],['announcement','Announcements'],['deadline','Deadlines']];
 const options=categories.map(([kind,title])=>`<option value="${kind}" ${updateFilter===kind?'selected':''}>${title}</option>`).join('');
 const groups=categories.filter(([kind])=>kind===updateFilter).map(([kind,title])=>{
  const items=rows.filter(u=>(['announcement','deadline'].includes(u.kind)?u.kind:'material')===kind);
  return items.length?`<section class="panel update-group"><div class="panel-heading"><h2>${title}</h2><span class="badge">${items.length}</span></div>${items.map(u=>`<article class="update"><div class="task-meta"><span>${esc(u.course)}</span><span>${esc(day(u.changed))}</span></div><h3>${u.seen?'':'• '}${esc(plainText(u.title))}</h3>${u.body&&u.body!=='Open SPeCTRUM to view the latest version.'?`<p>${esc(plainText(typeof u.body==='string'?u.body:''))}</p>`:''}${external(u.url,'Open in SPeCTRUM')} ${!u.seen?`<button class="quiet" data-seen="${esc(u.id)}">Mark read</button>`:''}</article>`).join('')}</section>`:'';
 }).join('');
 const empty=rows.length?`<div class="empty"><h2>No ${categories.find(([kind])=>kind===updateFilter)[1].toLowerCase()}${filter==='all'?' yet':' for this course'}</h2></div>`:updatesEmpty();
 return heading('Course updates')+`<div class="filter-row">${courseSelect()}<label><span>Filter by type</span><select id="update-filter">${options}</select></label></div>`+(groups||`<section class="panel">${empty}</section>`);
}
function deadlineEmpty(){
 if(filter!=='all'&&state.tasks.length)return `<div class="empty"><h2>No matching deadlines</h2><p>No deadlines match this course and status.</p><button id="clear-filters">Clear filters</button></div>`;
 if(taskFilter==='active'&&state.tasks.length)return `<div class="empty"><h2>You’re all caught up.</h2><p>All your saved deadlines are completed or submitted.</p><button id="show-completed">View completed deadlines</button></div>`;
 if(taskFilter==='completed')return `<div class="empty"><h2>No completed deadlines yet</h2><p>Completed and university-confirmed submissions will appear here.</p><button id="show-pending">View pending deadlines</button></div>`;
 return `<div class="empty"><h2>No deadlines saved yet</h2><p>${state.connected?state.lastSync?'Your successful checks have not collected any deadlines. You can add your own.':'Your first successful course check will collect available deadlines. You can add your own now.':'Add your own deadline, or connect SPeCTRUM to collect assignments.'}</p><button data-add="task">Add deadline</button> ${state.connected?'<a href="#settings/connection">Check course connection →</a>':'<a href="#settings/connection">Connect SPeCTRUM →</a>'}</div>`;
}
function updatesEmpty(){
 if(filter!=='all'&&state.updates.length)return `<div class="empty"><h2>No updates for this course</h2><p>Your other courses may have updates.</p><button id="clear-filters">Clear filter</button></div>`;
 if(!state.connected)return '<div class="empty"><h2>Connect to collect course updates</h2><p>Updates will appear after your courses are connected and checked.</p><a href="#settings/connection">Connect SPeCTRUM →</a></div>';
 if(!state.lastSync)return '<div class="empty"><h2>Waiting for the first course check</h2><p>The first successful check establishes a starting point. New changes appear after that.</p><button id="sync">Check a course now</button></div>';
 if(state.partial.length||state.connection!=='Connected')return '<div class="empty"><h2>Course checks need attention</h2><p>No updates are available here yet. Review the connection warnings before relying on this list.</p><a href="#settings/connection">Review course connection →</a></div>';
 return '<div class="empty"><h2>No new course changes collected</h2><p>Your first check establishes a starting point. Later announcements, materials and deadline changes appear here.</p><a href="#settings/connection">Review course checks →</a></div>';
}
function semester(){return semesterView(state);}
function settings(){
 const section=location.hash.split('/')[1]||'';
 const pages={
  notifications:{title:'Notifications',content:notificationPanel()},
  connection:{title:'SPeCTRUM connection',content:`<section class="panel"><h2>Course sync</h2><p>${esc(state.connection)}</p><p class="subtle">${state.lastSync?'Last check: '+esc(fmt(state.lastSync)):'No course checks yet.'}</p><form id="connect-form"><label>Mobile access token<input type="password" name="token" autocomplete="off" required></label><button class="primary">Connect courses</button></form><div class="actions"><button id="sync">Check courses now</button><button id="disconnect">Disconnect courses</button></div>${state.partial.map(p=>`<p class="notice">${esc(p.value)}</p>`).join('')}</section>`+attendanceConnection(state,{esc})},
  account:{title:'Account',content:`<section class="panel"><h2>Private access</h2><p class="subtle">Cloud reminder service: ${state.lastTick?'last checked '+esc(fmt(state.lastTick)):'not yet observed running'}</p><button id="logout">Sign out</button></section>`},
  about:{title:'About',content:`<section class="panel"><h2>Better Spectrum</h2><p>Release ${esc(state.release||'development')}</p><p>All dates and times use Malaysia time (MYT). Saved class and deadline reminders are handled by the cloud service.</p><p>Live SPeCTRUM collection requires a supported access token. Attendance auto-marking is optional and follows matching saved class times when enabled. WIX1003 stays manual.</p></section>`},
  help:{title:'Help',content:`<section class="panel"><h2>Using your planner</h2><h3>Phone reminders</h3><p>On iPhone, open the app in Safari, choose Share → Add to Home Screen, and open the installed app. In Settings, enable Notifications. <a href="#settings/notifications">Test notifications →</a></p><h3>Courses and deadlines</h3><p>Connect a supported Moodle mobile token under SPeCTRUM connection. You can add deadlines manually from Today or Deadlines.</p><h3>Attendance</h3><p>WIX1003 and sessions requiring a password, QR code or campus network stay manual. Turn off auto-marking when you will not attend.</p><h3>Something not working?</h3><p>Check the connection status under SPeCTRUM connection and delivery status under Notifications.</p></section>`}
 };
 const row=(key,name,symbol)=>`<a class="settings-row" href="#settings/${key}">${icon(symbol)}<span>${name}</span><span class="settings-chevron" aria-hidden="true">›</span></a>`;
 const chosen=pages[section];
 return `<div class="settings-page ${chosen?'settings-detail':'settings-menu'}"><header class="settings-header"><a href="${chosen?'#settings':'#today'}" aria-label="${chosen?'Back to settings':'Close settings'}">${chosen?'‹':'×'}</a><h1>${chosen?chosen.title:'Settings'}</h1></header>${chosen?`<div class="settings-detail-content">${chosen.content}</div>`:`<div class="settings-group">${row('account','Account','account')}${row('connection','SPeCTRUM connection','connection')}${notificationSwitch(icon)}${attendanceSwitch(state,icon)}</div><div class="settings-group">${row('about','About','about')}${row('help','Help','help')}</div><div class="settings-group settings-bottom"><button class="settings-row" id="logout">Log out</button><p class="settings-version">Better Spectrum · ${esc((state.release||'development').slice(0,12))}</p></div>`}</div>`;
}
function render(){const page=location.hash.slice(1).split('/')[0]||'today',views={today,timetable,tasks,updates,settings,semester};$('#view').innerHTML=(views[page]||today)();$('#page-label').textContent={today:'Today',timetable:'Timetable',tasks:'Deadlines',updates:'Course updates',settings:'Settings',semester:'Plan semester'}[page]||'Overview';document.querySelectorAll('nav a').forEach(a=>{a.classList.toggle('active',a.hash===`#${page==='semester'?'timetable':page}`);a.setAttribute('aria-current',a.hash===`#${page==='semester'?'timetable':page}`?'page':'false');});const selectedDate=page==='today'?(agendaDay||dateKey(new Date())):page==='timetable'?(timetableDay||dateKey(Date.now()+week*7*86400000)):dateKey(new Date());const selectedSemester=page==='semester'?state.semesters?.find(s=>s.id===location.hash.split('/')[1]):semesterForDate(state.semesters||[],selectedDate);$('#semester-label').textContent=selectedSemester?.name||(page==='semester'?'Planning a semester':state.semesters?.length?'No semester for these dates':'Your saved timetable');$('#course-list').innerHTML=state.courses.map(c=>`<div class="course-small"><span class="course-dot" data-color="${esc(c.code)}"></span>${esc(c.code)}</div>`).join('');const connected=state.connected??!/^Not connected/.test(state.connection||'Not connected');$('#connection-strip').innerHTML=`<span><strong>${esc(connected?(state.partial.length?'Connected · some course checks need attention':state.connection):'Disconnected')}</strong><small>${esc(state.lastSync?'Last successful course check '+fmt(state.lastSync,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'No successful course check yet')}</small></span><a href="#settings/connection">${connected?'Connection settings':'Connect SPeCTRUM'} →</a>`;document.querySelectorAll('[data-color]').forEach(e=>e.style.backgroundColor=color(e.dataset.color));document.querySelectorAll('[data-border]').forEach(e=>e.style.borderLeftColor=color(e.dataset.border));document.querySelectorAll('[data-week-color]').forEach(e=>{const fill=color(e.dataset.weekColor);e.style.setProperty('--course-color',/^#[0-9a-f]{6}$/i.test(fill)?fill:'#4263b5');});bind();}
function editor(type,id){
 if(saving)return;
 if(!state.courses.length){pendingAdd=type;$('#setup-intent').textContent=type==='task'?'Before adding a deadline, add your courses.':'Before adding a class, add your courses.';$('#course-setup').showModal();return;}
 const item=(type==='task'?state.tasks:state.classes).find(c=>c.id===id),form=$('#editor-form');
 editorKey=`editor:${type}:${id||'new'}`;const saved=readDraft(editorKey);form.reset();
 form.elements.type.value=type;form.elements.id.value=id||saved?.id||crypto.randomUUID();form.elements.edit.value=id&&type==='task'?'yes':'';
 form.elements.original.value=JSON.stringify(item||{});
 $('#editor-title').textContent=id?(type==='task'?'Edit deadline':'Edit class'):(type==='task'?'Add deadline':'Add class');
 $('#task-fields').hidden=type!=='task';$('#class-fields').hidden=type!=='class';
 form.elements.course.innerHTML=state.courses.map(c=>`<option value="${esc(c.code)}">${esc(c.code)} � ${esc(label(c.code))}</option>`).join('');
 if(item){for(const k of ['course','kind','room','occ','title','reminder_minutes'])if(form.elements[k]&&item[k]!=null)form.elements[k].value=item[k];for(const k of ['starts','ends','due'])if(item[k])form.elements[k].value=localInput(item[k]);}
 if(saved)for(const k of ['course','kind','room','occ','title','reminder_minutes','starts','ends','due','original'])if(saved[k]!=null)form.elements[k].value=saved[k];
 $('#form-error').className='form-feedback';$('#form-error').textContent=saved?'Your unfinished draft has been restored.':'Drafts stay in this tab until you save, discard, or sign out.';editorConflict();$('#editor').showModal();

}
function localInput(d){return dateKey(d)+'T'+time(d);}
function bind(){
 applyTimetableLayout();
 bindNotifications(state,{api,load,action,toast});
 $('#clear-filters')?.addEventListener('click',()=>{filter='all';taskFilter='all';render();});
 $('#update-filter')?.addEventListener('change',e=>{updateFilter=e.target.value;render();$('#update-filter')?.focus();});
 $('#show-completed')?.addEventListener('click',()=>{taskFilter='completed';render();});
 $('#show-pending')?.addEventListener('click',()=>{taskFilter='active';render();});
 bindAttendance({api,load,action,toast});
 bindSemester(state,{api,load,render,toast,fmt,dateKey,action});
 document.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{agendaDay=b.dataset.day;render();});
 document.querySelectorAll('[data-shift-day]').forEach(b=>b.onclick=()=>{agendaDay=dateKey(new Date(Date.parse(agendaDay+'T12:00:00+08:00')+Number(b.dataset.shiftDay)*86400000));render();});
 $('#agenda-today')?.addEventListener('click',()=>{agendaDay=dateKey(new Date());render();});
 document.querySelectorAll('[data-timetable-day]').forEach(b=>b.onclick=()=>{timetableDay=b.dataset.timetableDay;render();[...document.querySelectorAll('[data-timetable-day]')].find(e=>e.dataset.timetableDay===timetableDay&&e.getClientRects().length)?.focus({preventScroll:true});});
 document.querySelectorAll('[data-timetable-mode]').forEach(b=>b.onclick=()=>{timetableMode=b.dataset.timetableMode;render();document.querySelector('[data-timetable-mode="'+timetableMode+'"]')?.focus({preventScroll:true});});
 document.querySelectorAll('[data-detail-id]').forEach(b=>b.onclick=()=>showDetail(b.dataset.detailType,b.dataset.detailId));
 document.querySelectorAll('[data-restore-id]').forEach(b=>b.onclick=()=>action(()=>restore(b.dataset.restoreType,b.dataset.restoreId),b,'Restoring…',true));
 document.querySelectorAll('[data-edit-task]').forEach(b=>b.onclick=()=>editor('task',b.dataset.editTask));
 document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{const menu=b.closest('details');if(menu)menu.open=false;editor(b.dataset.add);});document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editor('class',b.dataset.edit));
 $('#course-filter')?.addEventListener('change',e=>{filter=e.target.value;render();});$('#task-filter')?.addEventListener('change',e=>{taskFilter=e.target.value;render();});
 $('#prev-week')?.addEventListener('click',()=>{week--;timetableDay=null;render();});$('#next-week')?.addEventListener('click',()=>{week++;timetableDay=null;render();});$('#this-week')?.addEventListener('click',()=>{week=0;timetableDay=null;render();});
 document.querySelectorAll('[data-complete]').forEach(b=>b.onclick=()=>action(async()=>{await api('task-status',{id:b.dataset.complete,done:active(state.tasks.find(t=>t.id===b.dataset.complete))});await load();}));
 for(const [selector,type,attr] of [['[data-delete-task]','task','deleteTask'],['[data-delete-class]','class','deleteClass']])document.querySelectorAll(selector).forEach(b=>b.onclick=()=>remove(type,b.dataset[attr]));
 document.querySelectorAll('[data-seen]').forEach(b=>b.onclick=()=>action(async()=>{await api('seen',{id:b.dataset.seen});await load();},b,'Marking read…'));
 $('#connect-form')?.addEventListener('submit',e=>{e.preventDefault();const token=new FormData(e.target).get('token');action(async()=>{await api('connect',{token});await load();toast('Connected. Courses will be checked in rotation.');});});
 $('#sync')?.addEventListener('click',()=>action(async()=>{await api('sync',{});await load();toast('First course checked. Other courses are checked by the cloud schedule.');}));
 $('#disconnect')?.addEventListener('click',()=>action(async()=>{await api('disconnect',{});await load();toast('Disconnected. Saved timetable and task reminders remain available.');}));
 $('#logout')?.addEventListener('click',()=>action(async()=>{await api('logout',{});clearDrafts();resetSemesterDraft();editorKey=null;pendingAdd=null;$('#editor-form').reset();state=null;$('#app').hidden=true;$('#login').hidden=false;}));
}
async function action(fn,control,label,retry=false){
 const activeControl=control||document.activeElement;
 const button=activeControl?.tagName==='BUTTON'?activeControl:activeControl?.closest?.('form')?.querySelector('button[type="submit"],button:not([type])')||activeControl;
 const names={refresh:'Refreshing records…',sync:'Checking courses…','enable-push':'Enabling notifications…','disable-push':'Disabling notifications…','test-push':'Sending test…','delay-push':'Scheduling test…','delivery-status':'Checking deliveries…',disconnect:'Disconnecting…',logout:'Signing out…','attendance-enabled':'Updating attendance settings…','attendance-support':'Checking connection method…','attendance-pair':'Generating pairing code…','attendance-login':'Connecting attendance…','attendance-qr':'Connecting attendance…','connect-form':'Connecting SPeCTRUM…'};
 const formId=button?.closest?.('form')?.id;
 label ||= names[button?.id]||names[formId]||(button?.textContent?.trim()?button.textContent.trim()+'…':'Working…');
 const fallback=$('#action-status');
 if(busy){fallback.hidden=false;fallback.textContent='Another action is still running. Please wait for it to finish, then try again.';return false;}
 let feedback=fallback;
 if(button?.isConnected&&button.type!=='checkbox'){feedback=button.parentElement.querySelector(':scope > .action-feedback');if(!feedback){feedback=document.createElement('div');feedback.className='action-feedback';feedback.setAttribute('role','status');button.insertAdjacentElement('afterend',feedback);}}
 const report=message=>{const target=feedback.isConnected?feedback:fallback;target.hidden=false;target.textContent=message;return target;};
 busy=true;fallback.hidden=true;const wasDisabled=button?.disabled,original=button?.textContent;
 if(button){button.disabled=true;button.setAttribute('aria-busy','true');if(button.tagName==='BUTTON')button.textContent=label;}
 report(label);document.body.setAttribute('aria-busy','true');
 try{const result=await fn();if(result===false){report('Could not finish. Follow the recovery message above and try again.');return false;}if(feedback.isConnected){feedback.hidden=false;feedback.textContent='Done.';}return true;}
 catch(e){
  if(e.status===401){feedback.hidden=true;fallback.hidden=true;return false;}
  const target=report(e.message+' Your action could not be confirmed.');
  if(retry||['refresh','sync','delivery-status','attendance-support'].includes(button?.id)){
   const again=document.createElement('button');again.textContent='Try again';again.onclick=()=>action(fn,button,label,true);target.append(again);
  }return false;
 }finally{busy=false;document.body.removeAttribute('aria-busy');if(button){button.disabled=wasDisabled;button.removeAttribute('aria-busy');if(button.tagName==='BUTTON')button.textContent=original;}}
}

$('#editor-form').addEventListener('submit',async e=>{
 e.preventDefault();if(saving)return;
 const form=e.target,data=Object.fromEntries(new FormData(form)),type=data.type;captureEditor();
 if(data.edit==='yes')data.original=JSON.parse(data.original);
 for(const k of type==='task'?['due']:['starts','ends']){if(!data[k]){$('#form-error').className='form-feedback danger';$('#form-error').textContent='Enter the required date and time.';return;}data[k]=new Date(data[k]+':00+08:00').toISOString();}
 if(type==='task'&&!data.title.trim()){$('#form-error').className='form-feedback danger';$('#form-error').textContent='Give your deadline a title.';return;}
 $('#form-error').className='form-feedback';saving=true;$('#editor-fields').disabled=true;$('#save-editor').textContent='Saving…';$('#form-error').textContent='Saving to your planner…';form.setAttribute('aria-busy','true');
 try{await api(type==='task'?(data.edit==='yes'?'task-update':'tasks'):'classes',data);deleteDraft(editorKey);editorKey=null;$('#editor').close();if(await load(true))toast('Saved to your planner.');}
 catch(err){$('#form-error').className='form-feedback danger';$('#form-error').textContent=err.message+' Your entries are still here.'+(err.status===409?'':' Review them and retry Save to check or complete the same save.');if(err.status===409&&data.edit==='yes')await load();}
 finally{saving=false;$('#editor-fields').disabled=false;$('#save-editor').textContent='Save to my planner';form.removeAttribute('aria-busy');}
});
$('#editor-form').addEventListener('input',captureEditor);
$('#reload-editor').onclick=()=>{const id=$('#editor-form').elements.id.value;deleteDraft(editorKey);$('#editor').close();editor('task',id);};
$('#reapply-editor').onclick=()=>{const form=$('#editor-form'),item=state.tasks.find(t=>t.id===form.elements.id.value);if(!item)return;form.elements.original.value=JSON.stringify(item);captureEditor();editorConflict();$('#form-error').textContent='Your draft is kept against the latest saved version. Review every field before saving.';};
$('#editor').addEventListener('cancel',e=>{if(saving)e.preventDefault();else captureEditor();});
$('#discard-editor').onclick=()=>{if(confirm('Discard this unfinished draft?')){deleteDraft(editorKey);editorKey=null;$('#editor').close();}};
window.addEventListener('beforeunload',e=>{if(draftsNeedWarning()){e.preventDefault();e.returnValue='';}});
$('#cancel-remove').onclick=()=>$('#remove-record').close();
$('#confirm-remove').onclick=e=>{const {type,id}=removal;return action(async()=>{await api(type==='class'?'class-delete':'task-delete',{id});$('#remove-record').close();await load();toast('Removed from your planner.',()=>restore(type,id));},e.currentTarget,'Removing…');};
$('#retry-load').onclick=()=>load();
$('#course-setup').querySelectorAll('a').forEach(a=>a.onclick=()=>$('#course-setup').close());
$('#close-setup').onclick=()=>{pendingAdd=null;$('#course-setup').close();};
$('#course-setup').addEventListener('cancel',()=>{pendingAdd=null;});
$('#close-editor').onclick=()=>{captureEditor();$('#editor').close();};$('#login-form').addEventListener('submit',async e=>{e.preventDefault();try{await api('login',{password:$('#password').value});$('#password').value='';$('#login-error').textContent='';await load();}catch(e){$('#login-error').textContent=e.message;}});$('#refresh').onclick=()=>action(load);window.addEventListener('hashchange',()=>{if(state){render();window.scrollTo(0,0);document.querySelector('#view h1')?.focus({preventScroll:true});}});if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});load();

$('#close-details').onclick=()=>$('#details').close();
window.addEventListener('resize',()=>applyTimetableLayout());
setInterval(()=>{if(!document.hidden)updateTimetableClock();},60000);
