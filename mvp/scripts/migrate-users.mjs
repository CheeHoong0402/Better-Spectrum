import {readFile,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {d1} from './d1.mjs';
import {activateOwner,validateLegacySettings} from './owner-migration.mjs';

const remote=process.argv.includes('--remote'),apply=process.argv.includes('--apply');
const DB=d1({remote}),existing=await DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('users','settings')").all();
if(!apply){console.log(existing.results.some(t=>t.name==='settings')?'Legacy single-user database: migration required.':'No legacy settings table found. Validate the owner and schema before deploying.');process.exit(0);}
const auth=JSON.parse(await readFile('.private/auth.json','utf8'));
const owner=JSON.parse(await readFile('.private/invite-legacy-owner.json','utf8'));
if(owner.email.toLowerCase()!==auth.ownerEmail.toLowerCase())throw new Error('Owner identity does not match the configured owner.');
const secrets=JSON.parse(await readFile('.private/secrets.json','utf8'));
if(!secrets.AUTH_SECRET||!secrets.DATA_ENCRYPTION_KEY)throw new Error('Preserve the old AUTH_SECRET and provision a separate DATA_ENCRYPTION_KEY first.');
if(remote){
 const production=JSON.parse(await readFile('wrangler.production.jsonc','utf8')),origin=production.vars?.PLANNER_URL;
 if(!origin||new URL(origin).protocol!=='https:')throw new Error('Configure the production origin.');
 const version=await(await fetch(new URL('/api/version',origin),{cache:'no-store'})).json();
 if(!version.maintenance||(await fetch(new URL('/api/state',origin))).status!==503)throw new Error('Deploy the new Worker with MAINTENANCE=1 first.');
 const started=Number(process.env.MAINTENANCE_STARTED_AT);
 if(!started||Date.now()-started<15*60000)throw new Error('Wait 15 minutes after verified maintenance began so old cron/request invocations can drain. Set MAINTENANCE_STARTED_AT to that epoch in milliseconds.');
 const backup=spawnSync(process.execPath,['scripts/backup.mjs','wrangler.production.jsonc'],{stdio:'inherit'});if(backup.status!==0)throw new Error('Verified backup is required.');
}
if(existing.results.some(t=>t.name==='settings')){
 validateLegacySettings((await DB.prepare('SELECT key,value FROM settings').all()).results);
 const sourceTables=['tasks','classes','updates','snapshots','subscriptions','deliveries','semesters','class_occurrences','content_scopes','update_scopes','attendance_sessions'];
 const before={};for(const table of sourceTables)before[table]=(await DB.prepare(`SELECT count(*) AS n FROM ${table}`).first()).n;
 await DB.file(await readFile('migrations/0004_multi_user.sql','utf8'));
 for(const table of sourceTables)if((await DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id='legacy-owner'`).first()).n!==before[table])throw new Error('Migrated record counts differ. Keep maintenance enabled.');
}else if(!existing.results.some(t=>t.name==='users'))await DB.file(await readFile('schema.sql','utf8'));
const legacy=await DB.prepare("SELECT status,auth_subject FROM users WHERE id='legacy-owner'").first();
if(legacy&&!legacy.auth_subject)await activateOwner(DB,{subject:owner.subject,email:owner.email,oldSecret:secrets.AUTH_SECRET,dataKey:secrets.DATA_ENCRYPTION_KEY});
else if(!legacy)await DB.prepare('INSERT INTO users (id,auth_subject,email) VALUES (?,?,?)').bind('legacy-owner',owner.subject,owner.email.toLowerCase()).run();
if((await DB.prepare('PRAGMA foreign_key_check').all()).results.length)throw new Error('Migration has invalid ownership relationships. Keep maintenance enabled.');
await DB.file("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);\n"+(await readdir('migrations')).filter(n=>/^000[1-4]_.*\.sql$/.test(n)).map(name=>`INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${name}');`).join('\n'));
await writeFile('.private/multi-user-migration-report.json',JSON.stringify({date:new Date().toISOString(),ownerId:'legacy-owner',foreignKeys:true,remote},null,2),{mode:0o600});
console.log('Ownership migration verified. Keep maintenance enabled until owner login and device tests pass.');
