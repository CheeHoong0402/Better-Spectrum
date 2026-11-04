import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {attendancePanel} from '../public/attendance.js';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const render=source.slice(source.indexOf('function settings(){'),source.indexOf('function render(){'));
function settings(hash){return runInNewContext(render+';settings()',{
 location:{hash},window:{},state:{subscriptions:0,pushReady:true,connection:'Not connected',partial:[],courses:[],classes:[]},
 icon:()=>'<svg></svg>',esc:String,fmt:String,day:String,time:String,dateKey:String,external:()=>'',attendancePanel
});}
test('settings rows lead to the existing functional controls',()=>{
 const menu=settings('#settings');
 for(const section of ['account','connection','notifications','timetable','about','help'])assert.ok(menu.includes('#settings/'+section));
 assert.ok(menu.includes('id="logout"'));
 assert.ok(!menu.includes('id="connect-form"'));
 const notifications=settings('#settings/notifications');
 for(const id of ['enable-push','disable-push','test-push','delay-push','delivery-status'])assert.ok(notifications.includes('id="'+id+'"'));
 const connection=settings('#settings/connection');
 for(const id of ['connect-form','sync','disconnect'])assert.ok(connection.includes('id="'+id+'"'));
 assert.ok(settings('#settings/account').includes('id="logout"'));
 assert.ok(settings('#settings/timetable').includes('https://maya.um.edu.my/'));
 const attendance=settings('#settings/timetable');assert.match(attendance,/role="switch"/);assert.match(attendance,/WIX1003 lectures and tutorials stay manual/);assert.match(attendance,/id="attendance-support"/);assert.match(attendance,/id="attendance-qr"/);
 assert.ok(settings('#settings/unknown').includes('settings-menu'));
});
