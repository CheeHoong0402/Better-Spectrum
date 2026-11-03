import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const identifier=s=>'"'+s.replaceAll('"','""')+'"';
const value=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
export function backupSql(schema,tables){
 const statements=['PRAGMA foreign_keys=OFF;'];
 for(const item of schema.filter(s=>s.type==='table')){
  statements.push(item.sql+';');
  for(const row of tables[item.name])statements.push(`INSERT INTO ${identifier(item.name)} (${Object.keys(row).map(identifier).join(',')}) VALUES (${Object.values(row).map(value).join(',')});`);
 }
 for(const item of schema.filter(s=>s.type!=='table'))statements.push(item.sql+';');
 return statements.join('\n')+'\n';
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=process.argv[2]||'wrangler.production.jsonc';
 await access(config);
 function query(sql){
  const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--remote','--config',config,'--command',sql,'--json'],{encoding:'utf8',maxBuffer:32*1024*1024});
  if(result.status!==0)throw new Error(result.stderr||'D1 backup query failed');
  const responses=JSON.parse(result.stdout);if(responses.some(r=>!r.success))throw new Error('D1 backup query failed');
  return responses[0].results;
 }
 const schema=query("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name");
 const tables={};for(const item of schema.filter(s=>s.type==='table'))tables[item.name]=query(`SELECT * FROM ${identifier(item.name)}`);
 const sql=backupSql(schema,tables),check=new DatabaseSync(':memory:');
 try{
  check.exec(sql);
  for(const [name,rows] of Object.entries(tables))if(check.prepare(`SELECT COUNT(*) AS n FROM ${identifier(name)}`).get().n!==rows.length)throw new Error('Backup verification failed');
 }finally{check.close();}
 await mkdir('.private/backups',{recursive:true});
 const file=`.private/backups/database-${new Date().toISOString().replaceAll(':','-')}.sql`;
 await writeFile(file,sql,{mode:0o600,flag:'wx'});
 console.log(`Verified private backup saved: ${file} (${Object.keys(tables).length} tables).`);
}
