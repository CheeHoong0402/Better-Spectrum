import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sqliteAdapter} from '../test-support/db.js';
import {activateOwner,validateLegacySettings} from '../scripts/owner-migration.mjs';
import {seal,unsealCredential} from '../src/security.js';
import {backupSql} from '../scripts/backup.mjs';
import {userEnvironment} from '../src/tenant.js';
import {setting} from '../src/moodle.js';

async function legacy(t){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../test-support/legacy-schema.sql',import.meta.url),'utf8'));
 const DB=sqliteAdapter(sqlite),original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({userid:42});t.after(()=>{globalThis.fetch=original;sqlite.close();});
 await DB.prepare('INSERT INTO settings VALUES (?,?)').bind('moodle_token',await seal('legacy-private-token','old-key')).run();
 sqlite.exec("INSERT INTO settings VALUES ('attendance_enabled','1'),('removed:task:old','{\"type\":\"task\",\"item\":{\"id\":\"old\"}}');INSERT INTO tasks (id,course,title,due,status) VALUES ('same-id','TEST','Original deadline','2030-01-01','done');INSERT INTO subscriptions VALUES ('device','{}');INSERT INTO deliveries (id,subscription_id,payload,due,sent) VALUES ('sent','device','{}','2030-01-01','sent');INSERT INTO semesters VALUES ('term','{}',3);INSERT INTO classes (id,course,kind,starts,ends,room) VALUES ('class','TEST','Lecture','2030-01-01T00:00:00Z','2030-01-01T01:00:00Z','Edited room');INSERT INTO class_occurrences VALUES ('class','term','weekly','2030-01-01',1,0)");
 return {sqlite,DB};
}
test('legacy migration preserves records, revisions, overrides, recovery and sent history, then explicitly activates the owner',async t=>{
 const {sqlite,DB}=await legacy(t);validateLegacySettings((await DB.prepare('SELECT * FROM settings').all()).results);
 const migration=readFileSync(new URL('../migrations/0004_multi_user.sql',import.meta.url),'utf8');sqlite.exec('BEGIN;'+migration+'COMMIT;');
 assert.equal(sqlite.prepare('SELECT status FROM users').get().status,'suspended');assert.equal(sqlite.prepare('SELECT count(*) n FROM sessions').get().n,0);
 await activateOwner(DB,{subject:'verified-owner-subject',email:'owner@example.com',oldSecret:'old-key',dataKey:'new-key'});
 const owner=sqlite.prepare("SELECT * FROM users WHERE id='legacy-owner'").get(),env=userEnvironment({DB,DATA_ENCRYPTION_KEY:'new-key'},owner);
 assert.equal(owner.auth_subject,'verified-owner-subject');assert.equal(owner.moodle_user_id,42);assert.equal(owner.status,'active');
 assert.equal(await unsealCredential(env,'moodle_token',await setting(env.DB,'moodle_token')),'legacy-private-token');
 assert.equal(await setting(env.DB,'attendance_enabled'),'0');assert.ok(await setting(env.DB,'removed:task:old'));
 assert.equal(sqlite.prepare('SELECT revision FROM semesters').get().revision,3);assert.equal(sqlite.prepare('SELECT overridden FROM class_occurrences').get().overridden,1);assert.equal(sqlite.prepare('SELECT room FROM classes').get().room,'Edited room');
 assert.equal(sqlite.prepare('SELECT sent FROM deliveries').get().sent,'sent');assert.equal(sqlite.prepare('SELECT status FROM tasks').get().status,'done');assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 const schema=sqlite.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),tables={};for(const item of schema.filter(s=>s.type==='table'))tables[item.name]=sqlite.prepare('SELECT * FROM "'+item.name+'"').all();
 const restore=new DatabaseSync(':memory:');try{restore.exec(backupSql(schema,tables));assert.equal(restore.prepare('SELECT title FROM tasks').get().title,'Original deadline');assert.deepEqual(restore.prepare('PRAGMA foreign_key_check').all(),[]);}finally{restore.close();}
});
test('unknown settings and unreadable legacy credentials block activation without granting access',async t=>{
 assert.doesNotThrow(()=>validateLegacySettings([{key:'seeded',value:'1'}]));
 const {sqlite,DB}=await legacy(t);assert.throws(()=>validateLegacySettings([{key:'unknown-credential',value:'private'}]),/unclassified/);
 sqlite.exec(readFileSync(new URL('../migrations/0004_multi_user.sql',import.meta.url),'utf8'));
 await assert.rejects(activateOwner(DB,{subject:'owner',email:'owner@example.com',oldSecret:'wrong',dataKey:'new'}));assert.equal(sqlite.prepare('SELECT status FROM users').get().status,'suspended');
});
