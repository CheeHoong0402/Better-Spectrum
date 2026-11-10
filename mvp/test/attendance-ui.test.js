import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceConnection,bindAttendance} from '../public/attendance.js';
const helpers={esc:s=>String(s??'')};

test('connected attendance setup stays collapsed with unique sign-in controls',()=>{
 const state={connected:true,attendance:{connected:true,connection:'Connected'}};
 const view=attendanceConnection(state,helpers);
 assert.match(view,/<details class="attendance-connection" >/);
 for(const id of ['attendance-qr','attendance-pair','attendance-support','attendance-login','attendance-disconnect'])assert.equal(view.split(`id="${id}"`).length-1,1);
 assert.doesNotMatch(view,/attendance-check|attendance-session|Today & tomorrow|attendance-enabled/);
});

test('disconnected attendance opens QR setup under SPeCTRUM connection',()=>{
 const view=attendanceConnection({connected:false,attendance:{connected:false}},helpers);
 assert.match(view,/<details class="attendance-connection" open>/);
 assert.match(view,/Your QR image stays on this device/);
 assert.match(view,/Connect your SPeCTRUM courses first/);
 assert.doesNotMatch(view,/attendance-login|attendance-check|attendance-enabled/);
});

test('attendance disconnect can be cancelled and only sends a request after confirmation',async t=>{
 const originalDocument=globalThis.document,originalConfirm=globalThis.confirm;
 t.after(()=>{globalThis.document=originalDocument;globalThis.confirm=originalConfirm;});
 let click;const calls=[];
 globalThis.document={querySelector:selector=>selector==='#attendance-disconnect'?{addEventListener:(event,handler)=>{click=handler;}}:null};
 bindAttendance({api:async path=>calls.push(path),load:async()=>{},action:fn=>fn(),toast:()=>{}});
 globalThis.confirm=()=>false;await click();assert.deepEqual(calls,[]);
 globalThis.confirm=()=>true;await click();assert.deepEqual(calls,['attendance-disconnect']);
});
