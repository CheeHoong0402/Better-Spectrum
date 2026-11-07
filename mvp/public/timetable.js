import {courseLabel} from './presentation.js';
export function semesterForDate(semesters,date){return semesters.filter(s=>s.start<=date&&s.end>=date).sort((a,b)=>b.start.localeCompare(a.start))[0]||null;}
const DAY=86400000;

export function weekLayout(classes,today,offset=0,filter='all'){
 const midnight=Date.parse(today+'T00:00:00+08:00'),weekday=new Date(midnight+8*3600000).getUTCDay();
 const monday=midnight-((weekday+6)%7)*DAY+offset*7*DAY;
 const slots=classes.filter(c=>(filter==='all'||c.course===filter)&&Date.parse(c.starts)<monday+7*DAY&&Date.parse(c.ends)>monday).sort((a,b)=>Date.parse(a.starts)-Date.parse(b.starts)||Date.parse(a.ends)-Date.parse(b.ends));
 const days=Array.from({length:7},(_,i)=>{
  const stamp=monday+i*DAY,date=new Date(stamp+8*3600000).toISOString().slice(0,10);
  const entries=slots.filter(c=>Date.parse(c.starts)<stamp+DAY&&Date.parse(c.ends)>stamp).map(c=>({item:c,start:Math.max(0,(Date.parse(c.starts)-stamp)/60000),end:Math.min(1440,(Date.parse(c.ends)-stamp)/60000)}));
  let group=[],lanes=[],until=0;
  const finish=()=>{for(const e of group)e.lanes=lanes.length;group=[];lanes=[];};
  for(const e of entries){
   if(e.start>=until)finish();
   let lane=lanes.findIndex(end=>end<=e.start);if(lane<0)lane=lanes.length;
   e.lane=lane;lanes[lane]=e.end;until=Math.max(until,e.end);group.push(e);
  }
  finish();return {stamp,date,entries};
 });
 const visible=days.filter((d,i)=>i<5||d.entries.length),entries=visible.flatMap(d=>d.entries);
 return {days:visible,slots,start:Math.floor(Math.min(480,...entries.map(e=>e.start))/60)*60,end:Math.ceil(Math.max(1140,...entries.map(e=>e.end))/60)*60};
}

export function timetableView(state,{today,week,filter,selectedDay,esc,fmt,time,day,courseSelect,mode='auto',now=Date.now()}){
 const layout=weekLayout(state.classes,today,week,filter),{days,slots,start,end}=layout;
 const agendaDays=Array.from({length:7},(_,i)=>{const stamp=days[0].stamp+i*DAY;return days.find(d=>d.stamp===stamp)||{stamp,date:new Date(stamp+8*3600000).toISOString().slice(0,10),entries:[]};});
 const selected=agendaDays.find(d=>d.date===selectedDay)||agendaDays.find(d=>d.date===today)||days[0];
 const semester=semesterForDate(state.semesters||[],selected.date);
 const weekNumber=semester?Math.floor((days[0].stamp-Date.parse(semester.week1+'T00:00:00+08:00'))/(7*DAY))+1:null;
 const weekCount=semester?Math.floor((Date.parse(semester.end+'T00:00:00+08:00')-Date.parse(semester.week1+'T00:00:00+08:00'))/(7*DAY))+1:null;
 const total=slots.reduce((sum,c)=>sum+(Math.min(Date.parse(c.ends),days[0].stamp+7*DAY)-Math.max(Date.parse(c.starts),days[0].stamp))/3600000,0);
 const range=fmt(days[0].stamp,{month:'short'})===fmt(days.at(-1).stamp,{month:'short'})?`${fmt(days[0].stamp,{day:'numeric'})}–${fmt(days.at(-1).stamp,{day:'numeric',month:'short'})}`:`${fmt(days[0].stamp,{day:'numeric',month:'short'})} – ${fmt(days.at(-1).stamp,{day:'numeric',month:'short'})}`;
 const hours=Array.from({length:(end-start)/60+1},(_,i)=>start/60+i);
 const nowMinutes=(now-Date.parse(today+'T00:00:00+08:00'))/60000;
 const courseName=c=>courseLabel(c.course,state.courses.find(x=>x.code===c.course)?.name||c.course);
 const code=c=>{const parts=String(c.course).match(/^([a-z]+)(\d.*)$/i);return parts?esc(parts[1])+'<wbr>'+esc(parts[2]):esc(c.course);};
 return `<section class="timetable-page schedule-mode-${mode} ${slots.length?'':'is-empty'}"><header class="schedule-heading"><div><p class="eyebrow">${esc(semester?.name||'YOUR TIMETABLE · '+fmt(days[0].stamp,{year:'numeric'}))}</p><div class="schedule-title"><h1 tabindex="-1">Timetable</h1>${weekNumber>0?`<span class="semester-week" aria-label="Week ${weekNumber} of ${weekCount}"><strong>W${weekNumber}</strong><span>OF ${weekCount}</span></span>`:''}</div><p class="schedule-meta"><span>${esc(range)}</span><span><strong>${slots.length}</strong> ${slots.length===1?'class':'classes'}</span><span><strong>${Number(total.toFixed(1))}</strong> hours this week</span></p></div><button class="primary schedule-add" data-add="class" aria-label="Add class"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>Add class</span></button></header>
 <div class="schedule-toolbar"><div class="schedule-navigation" aria-label="Navigate timetable weeks"><button id="prev-week" aria-label="Previous week">‹</button><button id="this-week">This week</button><button id="next-week" aria-label="Next week">›</button></div>${courseSelect()}<div class="view-choice" aria-label="Timetable view"><button data-timetable-mode="day" aria-pressed="${mode==='day'}">Day</button><button data-timetable-mode="week" aria-pressed="${mode==='week'}">Week</button></div></div>
 <div class="day-selector" data-day-count="7" aria-label="Choose a timetable day">${agendaDays.map(d=>`<button class="schedule-day ${d.date===today?'is-today':''}" data-timetable-day="${d.date}" aria-pressed="${d===selected}"><span>${esc(fmt(d.stamp,{weekday:'short'}))}</span><strong>${esc(fmt(d.stamp,{day:'numeric'}))}</strong></button>`).join('')}</div>
 ${!slots.length?`<div class="schedule-empty" role="status"><svg aria-hidden="true"><use href="#calendar"/></svg><h2>${filter==='all'?'No classes this week':'No classes for this course'}</h2><p>${filter==='all'?'Your saved timetable is clear for these dates.':'Try another course or return to All courses.'} You can still browse weeks or add a class.</p></div>`:''}
 <div class="schedule-scroll" role="region" aria-label="Weekly timetable in Malaysia time" tabindex="0"><div class="schedule-grid" data-day-count="${days.length}" data-grid-hours="${(end-start)/60}">
 <div class="schedule-days"><span class="schedule-zone">MYT</span>${days.map(d=>`<button class="schedule-day ${d.date===today?'is-today':''}" data-timetable-day="${d.date}" aria-pressed="${d===selected}" aria-label="${esc(day(d.stamp))}${d.date===today?', today':''}, ${d.entries.length} ${d.entries.length===1?'class':'classes'}"><span>${esc(fmt(d.stamp,{weekday:'short'}))}</span><strong>${esc(fmt(d.stamp,{day:'numeric'}))}</strong>${d.date===today?'<i aria-hidden="true"></i>':''}</button>`).join('')}</div>
 <div class="schedule-hours" aria-hidden="true">${hours.map(h=>`<span data-schedule-top="${(h*60-start)/(end-start)*100}">${String(h%24).padStart(2,'0')}</span>`).join('')}</div>
 ${days.map(d=>`<div class="schedule-column ${d.date===today?'is-today':''} ${d===selected?'is-selected':''}">${d.entries.map(e=>`<button class="week-event ${e.item.kind==='Tutorial'?'is-tutorial':''}" data-week-color="${esc(e.item.course)}" data-detail-type="class" data-detail-id="${esc(e.item.id)}" data-schedule-top="${(e.start-start)/(end-start)*100}" data-schedule-height="${(e.end-e.start)/(end-start)*100}" data-lane="${e.lane}" data-lanes="${e.lanes}" aria-label="${esc(e.item.course+' · '+courseName(e.item)+' · '+e.item.kind+' · '+day(d.stamp)+' · '+time(e.item.starts)+' to '+time(e.item.ends)+' · '+(e.item.room||'Room not specified'))}"><strong class="week-event-code">${code(e.item)}</strong><span class="week-event-name">${esc(courseName(e.item))}</span><span class="week-event-kind">${esc(e.item.kind)}</span><span class="week-event-room">${esc(e.item.room||'Room not specified')}</span></button>`).join('')}${`<div class="schedule-now" data-clock-day="${d.date}" data-clock-start="${start}" data-clock-end="${end}" ${d.date!==today||nowMinutes<start||nowMinutes>=end?'hidden':''} aria-label="Current time ${time(now)}"><span>${time(now)}</span></div>`}</div>`).join('')}
 </div></div>
 <div class="schedule-key"><span><i class="key-lecture" aria-hidden="true"></i>Lecture / lab</span><span><i class="key-tutorial" aria-hidden="true"></i>Tutorial</span><span><i class="key-now" aria-hidden="true"></i>Now</span></div>
 <section class="schedule-agenda" aria-labelledby="schedule-agenda-title"><div class="panel-heading"><div><h2 id="schedule-agenda-title">${esc(day(selected.stamp))}</h2></div><span>${selected.entries.length} ${selected.entries.length===1?'class':'classes'}</span></div>${selected.entries.map(({item:c})=>`<button class="schedule-agenda-item" data-detail-type="class" data-detail-id="${esc(c.id)}"><span class="schedule-agenda-time">${time(c.starts)}<small>${time(c.ends)}</small></span><span class="schedule-agenda-copy" data-border="${esc(c.course)}"><strong>${esc(courseName(c))}</strong><span>${esc(c.course)} · ${esc(c.kind)}</span><small>${esc(c.room||'Room not specified')} · OCC ${esc(c.occ||'—')}</small></span><span aria-hidden="true">›</span></button>`).join('')||'<p class="subtle">No saved classes for this day.</p>'}</section>
 <details class="schedule-manage"><summary>Manage your schedule</summary><div class="actions"><a class="semester-button" href="#semester/new">+ Plan semester</a>${(state.semesters||[]).map(s=>`<a class="semester-button" href="#semester/${esc(s.id)}">Edit ${esc(s.name)}</a>`).join('')}<a class="semester-button" href="#settings">Attendance settings →</a></div><p class="subtle">Individual class edits and cancellations stay available in class details. WIX1003 attendance stays manual.</p></details></section>`;
}

export function applyTimetableLayout(root=document){
 for(const strip of root.querySelectorAll('.date-strip,.day-selector')){const selected=strip.querySelector('[aria-pressed=true]');if(selected)strip.scrollLeft=Math.max(0,selected.offsetLeft-strip.offsetLeft-(strip.clientWidth-selected.clientWidth)/2);}
 for(const page of root.querySelectorAll('.schedule-mode-auto')){const mode=globalThis.matchMedia?.('(max-width:700px)').matches?'day':'week';for(const button of page.querySelectorAll('[data-timetable-mode]'))button.setAttribute('aria-pressed',String(button.dataset.timetableMode===mode));}
 // Set layout through CSS properties, as the app's CSP deliberately blocks HTML style attributes.
 for(const e of root.querySelectorAll('[data-day-count]'))e.style.setProperty('--day-count',e.dataset.dayCount);
 for(const e of root.querySelectorAll('[data-grid-hours]'))e.style.setProperty('--grid-hours',e.dataset.gridHours);
 for(const e of root.querySelectorAll('[data-schedule-top]'))e.style.top=e.dataset.scheduleTop+'%';
 for(const e of root.querySelectorAll('[data-schedule-height]'))e.style.height=e.dataset.scheduleHeight+'%';
 for(const e of root.querySelectorAll('[data-lanes]')){e.style.left='calc('+Number(e.dataset.lane)/Number(e.dataset.lanes)*100+'% + 2px)';e.style.width='calc('+100/Number(e.dataset.lanes)+'% - 4px)';}
 updateTimetableClock(root);
}

export function updateTimetableClock(root=document,now=Date.now()){
 const today=new Date(now+8*3600000).toISOString().slice(0,10),minutes=(now-Date.parse(today+'T00:00:00+08:00'))/60000;
 const label=new Date(now).toLocaleTimeString('en-GB',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',hour12:false});
 for(const e of root.querySelectorAll('[data-clock-day]')){
  const start=Number(e.dataset.clockStart),end=Number(e.dataset.clockEnd);
  e.hidden=e.dataset.clockDay!==today||minutes<start||minutes>=end;
  e.style.top=(minutes-start)/(end-start)*100+'%';e.setAttribute('aria-label','Current time '+label);e.firstElementChild.textContent=label;
 }
}
