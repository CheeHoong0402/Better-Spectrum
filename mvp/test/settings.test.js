import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {notificationPanel,notificationSwitch} from '../public/notifications.js';
import {attendancePanel,attendanceSwitch,attendanceConnection} from '../public/attendance.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function settings(){'),source.indexOf('function render(){'));
function settings(hash,attendance){return runInNewContext(render+';settings()',{
 location:{hash},window:{},state:{subscriptions:0,pushReady:true,connection:'Not connected',partial:[],courses:[],classes:[],attendance},
 icon:()=>'<svg></svg>',esc:String,fmt:String,day:String,time:String,dateKey:String,external:()=>'',attendancePanel,attendanceSwitch,attendanceConnection,notificationPanel,notificationSwitch
});}
test('settings rows lead to the existing functional controls',()=>{
 const menu=settings('#settings');
 for(const section of ['account','connection','attendance','about','help'])assert.ok(menu.includes('#settings/'+section));
 assert.ok(menu.includes('id="logout"'));
 assert.ok(!menu.includes('id="connect-form"'));
 assert.match(menu,/id="notifications-enabled"/);assert.match(menu,/role="switch"/);
 assert.doesNotMatch(menu,/id="attendance-enabled"|Timetable & attendance|#settings\/timetable/);
 const notifications=settings('#settings/notifications');
 for(const id of ['device-push','delivery-status'])assert.ok(notifications.includes('id="'+id+'"'));
 const connection=settings('#settings/connection');
 for(const id of ['connect-form','sync','disconnect'])assert.ok(connection.includes('id="'+id+'"'));
 assert.ok(settings('#settings/account').includes('id="logout"'));
 const attendance=settings('#settings/attendance');assert.match(attendance,/id="attendance-enabled"/);assert.doesNotMatch(attendance,/id="attendance-qr"|id="attendance-support"|https:\/\/maya.um.edu.my\//);assert.match(attendance,/id="attendance-check"/);
 assert.match(settings('#settings/timetable'),/<h1>Auto-mark attendance<\/h1>/);
 assert.match(connection,/id="attendance-support"/);assert.match(connection,/id="attendance-qr"/);assert.doesNotMatch(connection,/id="attendance-enabled"/);
 assert.ok(settings('#settings/unknown').includes('settings-menu'));
});

test('Auto-mark attendance reflects its state without timetable text and points disconnected users to setup',()=>{
 const connected=settings('#settings/attendance',{connected:true,enabled:true,sessions:[]});
 assert.match(connected,/role="switch" checked/);assert.doesNotMatch(connected,/role="switch" checked disabled/);
 const disconnected=settings('#settings/attendance',{connected:false,enabled:false,sessions:[]});
 assert.match(disconnected,/role="switch"\s+disabled/);assert.match(disconnected,/Connect attendance to enable/);
 assert.equal(connected.split('id="attendance-enabled"').length-1,1);
 assert.doesNotMatch(connected,/Uses your saved timetable|id="attendance-help"|<h2>Timetable<\/h2>/);
 assert.match(settings('#settings/help'),/WIX1003 and sessions requiring a password, QR code or campus network stay manual/);
});
