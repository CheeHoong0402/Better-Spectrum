import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {notificationPanel,notificationSwitch} from '../public/notifications.js';
import {attendanceSwitch,attendanceConnection} from '../public/attendance.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function settings(){'),source.indexOf('function render(){'));
function settings(hash,attendance){return runInNewContext(render+';settings()',{
 location:{hash},window:{},state:{subscriptions:0,pushReady:true,connection:'Not connected',partial:[],courses:[],classes:[],attendance},
 icon:name=>`<svg data-icon="${name}" aria-hidden="true"></svg>`,esc:String,fmt:String,day:String,time:String,dateKey:String,external:()=>'',attendanceSwitch,attendanceConnection,notificationPanel,notificationSwitch
});}
test('settings rows lead to the existing functional controls',()=>{
 const menu=settings('#settings');
 for(const section of ['account','connection','about','help'])assert.ok(menu.includes('#settings/'+section));
 assert.ok(menu.includes('id="logout"'));
 assert.ok(!menu.includes('id="connect-form"'));
 assert.match(menu,/id="notifications-enabled"/);assert.match(menu,/role="switch"/);
 assert.match(menu,/id="attendance-enabled"/);assert.doesNotMatch(menu,/Timetable & attendance|#settings\/attendance|#settings\/timetable|Today & tomorrow|Check sessions/);
 assert.match(menu,/<svg data-icon="bell" aria-hidden="true"><\/svg><span>Notifications<\/span>/);
 const notifications=settings('#settings/notifications');
 for(const id of ['device-push','delivery-status'])assert.ok(notifications.includes('id="'+id+'"'));
 const connection=settings('#settings/connection');
 for(const id of ['connect-form','sync','disconnect'])assert.ok(connection.includes('id="'+id+'"'));
 assert.match(connection,/Check next course now/);assert.match(connection,/Courses and submission statuses are checked in rotation/);
 assert.ok(settings('#settings/account').includes('id="logout"'));
 for(const route of ['#settings/attendance','#settings/timetable']){const oldPage=settings(route);assert.match(oldPage,/<h1[^>]*>Settings<\/h1>/);assert.doesNotMatch(oldPage,/attendance-check|attendance-session|Today & tomorrow/);}
 assert.match(connection,/id="attendance-support"/);assert.match(connection,/id="attendance-qr"/);assert.doesNotMatch(connection,/id="attendance-enabled"/);
 assert.ok(settings('#settings/unknown').includes('settings-menu'));
});

test('Auto-mark attendance reflects its state without timetable text and points disconnected users to setup',()=>{
 const connected=settings('#settings',{connected:true,enabled:true,sessions:[]});
 assert.match(connected,/role="switch" checked/);assert.doesNotMatch(connected,/role="switch" checked disabled/);
 const disconnected=settings('#settings',{connected:false,enabled:false,sessions:[]});
 assert.match(disconnected,/role="switch"\s+disabled/);assert.match(disconnected,/Connect attendance to enable/);
 assert.equal(connected.split('id="attendance-enabled"').length-1,1);
 assert.doesNotMatch(connected,/Uses your saved timetable|id="attendance-help"|<h2>Timetable<\/h2>/);
 assert.match(settings('#settings/help'),/WIX1003 and sessions requiring a password, QR code or campus network stay manual/);
});
