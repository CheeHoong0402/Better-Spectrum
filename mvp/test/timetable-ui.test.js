import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weekLayout,timetableView,updateTimetableClock} from '../public/timetable.js';

const entry=(id,date,start,end,extra={})=>({id,course:'WIX1001',kind:'Lecture',starts:`${date}T${start}:00+08:00`,ends:`${date}T${end}:00+08:00`,room:'DK 1',occ:'1',source:'manual',...extra});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(d,opts)=>new Date(d).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur',...opts});
const helpers={today:'2026-11-05',week:0,filter:'all',esc,fmt,time:d=>fmt(d,{hour:'2-digit',minute:'2-digit',hour12:false}),day:d=>fmt(d,{weekday:'long',day:'numeric',month:'short'}),courseSelect:()=>'<select id="course-filter"></select>',now:Date.parse('2026-11-05T09:30:00+08:00')};

test('weeks use Malaysia dates, Monday boundaries and the requested week offset',()=>{
 const classes=[entry('sun','2026-11-01','23:00','23:30'),entry('mon','2026-11-02','00:00','01:00'),entry('next','2026-11-09','09:00','10:00')];
 const week=weekLayout(classes,'2026-11-08');
 assert.equal(week.days[0].date,'2026-11-02');assert.deepEqual(week.slots.map(c=>c.id),['mon']);assert.equal(week.start,0);
 assert.deepEqual(weekLayout(classes,'2026-11-08',1).slots.map(c=>c.id),['next']);
 assert.equal(weekLayout(classes,'2026-11-02').days[0].date,'2026-11-02');
});
test('weekends, early and late classes appear and empty filters keep a usable scale',()=>{
 const classes=[entry('sat','2026-11-07','20:30','23:30'),entry('sun','2026-11-08','07:30','08:30',{course:'OTHER'})];
 const week=weekLayout(classes,'2026-11-05');assert.equal(week.days.length,7);assert.equal(week.start,420);assert.equal(week.end,1440);
 const filtered=weekLayout(classes,'2026-11-05',0,'WIX1001');assert.equal(filtered.days.length,6);assert.deepEqual(filtered.slots.map(c=>c.id),['sat']);
 const empty=weekLayout(classes,'2026-11-05',0,'MISSING');assert.equal(empty.days.length,5);assert.equal(empty.start,480);assert.equal(empty.end,1140);
});
test('overlapping classes get separate lanes; adjacent classes regain full width',()=>{
 const classes=[entry('long','2026-11-05','09:00','12:00'),entry('a','2026-11-05','09:30','10:00'),entry('b','2026-11-05','09:45','10:30'),entry('c','2026-11-05','10:30','11:00'),entry('after','2026-11-05','12:00','13:00')];
 const rows=weekLayout(classes,'2026-11-05').days[3].entries;
 assert.deepEqual(rows.map(e=>[e.lane,e.lanes]),[[0,3],[1,3],[2,3],[1,3],[0,1]]);
});
test('a class crossing midnight is clipped into both days without changing saved data',()=>{
 const c=entry('night','2026-11-08','23:30','23:59');c.ends='2026-11-09T00:30:00+08:00';const original=JSON.stringify(c);
 const current=weekLayout([c],'2026-11-05'),next=weekLayout([c],'2026-11-05',1);
 assert.deepEqual([current.days.at(-1).entries[0].start,current.days.at(-1).entries[0].end],[1410,1440]);
 assert.deepEqual([next.days[0].entries[0].start,next.days[0].entries[0].end],[0,30]);assert.equal(JSON.stringify(c),original);
});
test('timetable preserves class detail and semester links, escapes data and shows a readable selected-day list',()=>{
 const c=entry('id"<unsafe>','2026-11-05','09:00','10:00',{kind:'Tutorial',room:'<img src=x onerror=bad>'});
 const state={classes:[c],courses:[{code:'WIX1001',name:'Computing Mathematics'}],semesters:[{id:'semester-1',name:'Semester 1',start:'2026-10-05',end:'2027-01-17',week1:'2026-10-05'}]};
 const html=timetableView(state,helpers);
 assert.match(html,/W5/);assert.match(html,/OF 15/);assert.match(html,/is-tutorial/);assert.match(html,/data-detail-type="class"/);assert.match(html,/#semester\/semester-1/);
 assert.match(html,/schedule-agenda-copy/);assert.match(html,/OCC 1/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img src=x'));
 assert.match(html,/data-detail-id="id&quot;&lt;unsafe&gt;"/);assert.match(html,/class="schedule-now"/);
 assert.ok(!html.includes('style='),'layout must work with the existing strict style-src CSP');
 const unsafe=timetableView({...state,classes:[{...c,course:"'<svg>1"}]},helpers);
 assert.ok(unsafe.includes('&#39;&lt;svg&gt;1'));assert.ok(!unsafe.includes('<svg>1'));
 assert.ok(!timetableView(state,{...helpers,week:1}).includes('data-clock-day="2026-11-05"'));
});
test('the current-time marker updates without redrawing or moving focus and hides outside the shown hours',()=>{
 const marker={dataset:{clockDay:'2026-11-05',clockStart:'480',clockEnd:'1140'},style:{},setAttribute(k,v){this[k]=v;},firstElementChild:{}};
 const root={querySelectorAll:()=>[marker]};
 updateTimetableClock(root,Date.parse('2026-11-05T09:30:00+08:00'));assert.equal(marker.hidden,false);assert.equal(marker.firstElementChild.textContent,'09:30');assert.equal(marker.style.top,(90/660*100)+'%');
 updateTimetableClock(root,Date.parse('2026-11-05T20:00:00+08:00'));assert.equal(marker.hidden,true);
 updateTimetableClock(root,Date.parse('2026-11-06T09:30:00+08:00'));assert.equal(marker.hidden,true);
});
test('an empty week has a compact empty state while keeping navigation, day selection and add-class controls',()=>{
 const state={classes:[],courses:[],semesters:[]},html=timetableView(state,helpers);
 assert.match(html,/timetable-page is-empty/);assert.match(html,/No classes this week/);assert.match(html,/role="status"/);
 for(const control of ['prev-week','this-week','next-week','data-timetable-day','data-add="class"','aria-label="Add class"'])assert.ok(html.includes(control));
 const filtered=timetableView(state,{...helpers,filter:'WIX1001'});assert.match(filtered,/No classes for this course/);assert.match(filtered,/return to All courses/);
});
