import assert from 'node:assert/strict';
const base=process.env.PLANNER_URL,cookie=process.env.PLANNER_SESSION;
if(!base||!cookie)throw new Error('Set PLANNER_URL and a temporary PLANNER_SESSION cookie from your verified email login. Never paste it into chat.');
assert.equal((await fetch(base+'/api/state')).status,401);
const me=await fetch(base+'/api/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);const {user}=await me.json();
const response=await fetch(base+'/api/state',{headers:{Cookie:cookie,'X-Planner-User':user.id}});assert.equal(response.status,200);const state=await response.json();assert.equal(state.user.id,user.id);assert.equal(Object.hasOwn(state,'moodle_token'),false);
console.log('Authenticated owner, private access and secret filtering verified.');
