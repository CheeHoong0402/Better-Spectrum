import {d1} from './d1.mjs';
const DB=d1({remote:true});
const table=await DB.prepare("SELECT name FROM sqlite_schema WHERE name='users' AND type='table'").first();
if(!table)throw new Error('Production is still single-user. Rehearse and run scripts/migrate-users.mjs under maintenance before deploying this release.');
const ready=await DB.prepare("SELECT id FROM users WHERE status='active' AND auth_subject IS NOT NULL LIMIT 1").first();
if(!ready)throw new Error('Provision and verify the existing owner login before deployment.');
if((await DB.prepare('PRAGMA foreign_key_check').all()).results.length)throw new Error('Production ownership constraints failed.');
console.log('Multi-user database and active login identity verified.');
