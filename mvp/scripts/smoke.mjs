import assert from 'node:assert/strict';
const origin=process.env.SMOKE_ORIGIN||'http://127.0.0.1:8787';let cookie='';
async function req(path,data){return fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});}
assert.equal((await req('/')).status,200);
assert.equal((await req('/api/state')).status,401);
const login=await req('/api/login',{password:process.env.SMOKE_PASSWORD||'local-preview-only'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
const s=await(await req('/api/state')).json();assert.equal(s.courses.length,0);assert.equal(s.classes.length,0);assert.ok(!('token'in s));
assert.equal((await req('/api/tasks',{course:'COURSE-1',title:'Smoke test deadline',due:'2030-01-01T00:00:00+08:00',reminder_minutes:120})).status,200);
let tasks=(await(await req('/api/state')).json()).tasks;const task=tasks.find(t=>t.title==='Smoke test deadline');assert.ok(task);
assert.equal((await req('/api/task-status',{id:task.id,done:true})).status,200);
assert.equal((await req('/api/task-status',{id:'source-task-example',done:true})).status,400);
assert.equal((await req('/api/subscribe',{endpoint:'https://127.0.0.1/push'})).status,400);
assert.equal((await req('/api/task-delete',{id:task.id})).status,200);
assert.equal((await req('/api/classes',{course:'COURSE-1',starts:'2030-01-01T12:00:00+08:00',ends:'2030-01-01T11:00:00+08:00'})).status,400);
const csrf=await fetch(origin+'/api/tasks',{method:'POST',headers:{Origin:'https://other.example',Cookie:cookie},body:'{}'});assert.equal(csrf.status,403);
console.log('HTTP smoke checks passed: login, privacy, privacy, task persistence/completion, input validation, and cross-origin protection.');
