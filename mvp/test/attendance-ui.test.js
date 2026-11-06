import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendancePanel,attendanceConnection} from '../public/attendance.js';
const dateKey=s=>new Date(new Date(s).getTime()+8*3600000).toISOString().slice(0,10);
const today=dateKey(new Date()),tomorrow=dateKey(Date.now()+86400000);
const helpers={esc:s=>String(s??''),day:String,time:String,dateKey,external:()=>'<a>Open attendance</a>'};
test('attendance shows today first, keeps setup on the connection page and retains manual restrictions',()=>{
 const sessions=[{id:'tomorrow',course:'TEST',day:tomorrow,name:'Tomorrow session',label:'Tomorrow'},{id:'today',course:'TEST',day:today,name:'Today session',label:'Today'},{id:'manual',course:'WIX1003',day:today,name:'Manual session',label:'Manual',manual:1}];
 const state={courses:[],classes:[{id:'class',course:'TEST',starts:today+'T10:00:00+08:00',ends:new Date(Date.now()+86400000).toISOString()}],attendance:{connected:true,enabled:true,connection:'Connected',sessions}};
 const view=attendancePanel(state,helpers);
 assert.ok(view.indexOf('Today session')<view.indexOf('Tomorrow session'));
 assert.doesNotMatch(view,/attendance-connection|attendance-enabled|data-attendance-confirm=/);
 const connection=attendanceConnection(state,helpers);assert.match(connection,/<details class="attendance-connection" >/);
 assert.ok(view.includes('data-attendance-cancel="today"'));assert.ok(!view.includes('data-attendance-cancel="tomorrow"'));assert.ok(!view.includes('data-attendance-cancel="manual"'));
 for(const id of ['attendance-qr','attendance-pair','attendance-support'])assert.equal(connection.split(`id="${id}"`).length-1,1);
 assert.equal(view.split('id="attendance-check"').length-1,1);
 state.attendance.enabled=false;assert.ok(!attendancePanel(state,helpers).includes('data-attendance-cancel='));
});

test('recorded attendance hides stale failures and skipped sessions stay visibly skipped',()=>{
 const sessions=[{id:'recorded',course:'TEST',day:today,name:'Recorded session',label:'Today',recorded:'Present',message:'Attendance could not be verified.'},{id:'skipped',course:'TEST',day:today,name:'Skipped session',label:'Today',message:'Skipped by you'}];
 const view=attendancePanel({courses:[],classes:[],attendance:{connected:true,enabled:true,sessions}},helpers);
 assert.match(view,/Verified in SPeCTRUM/);assert.doesNotMatch(view,/could not be verified/);assert.match(view,/Skipped by you/);assert.doesNotMatch(view,/data-attendance-cancel=/);
});
test('disconnected attendance links to connection setup and keeps QR setup there',()=>{
 const state={courses:[],classes:[],attendance:{connected:false,enabled:false,sessions:[]}};
 const view=attendancePanel(state,helpers),connection=attendanceConnection(state,helpers);
 assert.match(connection,/<details class="attendance-connection" open>/);assert.match(connection,/Your QR image stays on this device/);
 assert.match(view,/#settings\/connection/);assert.doesNotMatch(view,/attendance-qr|data-attendance-confirm=/);
});
