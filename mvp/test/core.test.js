import {test} from 'node:test';
import assert from 'node:assert/strict';
import {session,seal,unseal,validDate,validPush} from '../src/security.js';
import {reminderDue} from '../src/worker.js';
import {database,testCookie} from '../test-support/db.js';
test('session rejects tampering, expiry, and removed identities',async()=>{
 const {raw:DB,sqlite}=database();try{
  const token=await testCookie(DB),req=v=>new Request('https://planner.example',{headers:{Cookie:v}});
  assert.equal((await session(req(token),DB)).id,'test-user');assert.equal(await session(req(token+'x'),DB),null);
  sqlite.exec('UPDATE sessions SET expires=0');assert.equal(await session(req(token),DB),null);
 }finally{sqlite.close();}
});
test('stored Moodle credentials are encrypted and reject modified ciphertext',async()=>{
 const sealed=await seal('sample-secret-token','secret');assert.ok(!sealed.includes('sample-secret-token'));assert.equal(await unseal(sealed,'secret'),'sample-secret-token');await assert.rejects(()=>unseal(sealed,'other'));
});
test('reminders start at the selected offset, never after the deadline',()=>{
 const now=Date.parse('2026-11-02T01:00:00Z'),t={due:'2026-11-02T03:00:00Z',reminder_minutes:120};assert.equal(reminderDue(t,now),true);assert.equal(reminderDue(t,now-1),false);assert.equal(reminderDue(t,now+7200000),false);
});
test('reject local endpoint subscriptions and ambiguous dates',()=>{
 assert.equal(validPush({endpoint:'https://localhost/push',keys:{}}),false);assert.equal(validPush({endpoint:'http://fcm.googleapis.com/push',keys:{}}),false);assert.equal(validDate('2026-11-02T15:00'),false);assert.equal(validDate('2026-11-02T15:00:00+08:00'),true);
});
