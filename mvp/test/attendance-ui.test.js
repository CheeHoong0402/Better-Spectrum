import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attendanceConnection} from '../public/attendance.js';
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
