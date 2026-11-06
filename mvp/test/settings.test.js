import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {notificationPanel} from '../public/notifications.js';
import {attendancePanel,attendanceSwitch,attendanceConnection} from '../public/attendance.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function settings(){'),source.indexOf('function render(){'));
function settings(hash,attendance){return runInNewContext(render+';settings()',{
 location:{hash},window:{},state:{subscriptions:0,pushReady:true,connection:'Not connected',partial:[],courses:[],classes:[],attendance},
 icon:()=>'<svg></svg>',esc:String,fmt:String,day:String,time:String,dateKey:String,external:()=>'',attendancePanel,attendanceSwitch,attendanceConnection,notificationPanel
});}
test('settings rows lead to the existing functional controls',()=>{
 const menu=settings('#settings');
 for(const section of ['account','connection','notifications','timetable','about','help'])assert.ok(menu.includes('#settings/'+section));
 assert.ok(menu.includes('id="logout"'));
 assert.ok(!menu.includes('id="connect-form"'));
 assert.match(menu,/id="attendance-enabled"/);assert.match(menu,/role="switch"/);
 const notifications=settings('#settings/notifications');
 for(const id of ['device-push','delivery-status'])assert.ok(notifications.includes('id="'+id+'"'));
 const connection=settings('#settings/connection');
 for(const id of ['connect-form','sync','disconnect'])assert.ok(connection.includes('id="'+id+'"'));
 assert.ok(settings('#settings/account').includes('id="logout"'));
 assert.ok(settings('#settings/timetable').includes('https://maya.um.edu.my/'));
 const attendance=settings('#settings/timetable');assert.doesNotMatch(attendance,/id="attendance-enabled"|id="attendance-qr"|id="attendance-support"/);assert.match(attendance,/id="attendance-check"/);
 assert.match(connection,/id="attendance-support"/);assert.match(connection,/id="attendance-qr"/);assert.doesNotMatch(connection,/id="attendance-enabled"/);
 assert.ok(settings('#settings/unknown').includes('settings-menu'));
});

test('the Settings switch reflects attendance state and points disconnected users to connection setup',()=>{
 const connected=settings('#settings',{connected:true,enabled:true,sessions:[]});
 assert.match(connected,/role="switch" checked/);assert.doesNotMatch(connected,/role="switch" checked disabled/);
 const disconnected=settings('#settings',{connected:false,enabled:false,sessions:[]});
 assert.match(disconnected,/role="switch"\s+disabled/);assert.match(disconnected,/Connect attendance to enable/);
 for(const id of ['attendance-enabled','attendance-help'])assert.equal(connected.split(`id="${id}"`).length-1,1);
 assert.match(settings('#settings/help'),/WIX1003 and sessions requiring a password, QR code or campus network stay manual/);
});
