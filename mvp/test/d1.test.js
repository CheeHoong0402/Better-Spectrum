import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('file migrations accept Wrangler progress text and still reject failed commands',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'planner-d1-'));
 try{
  const cli=join(directory,'node_modules/wrangler/bin/wrangler.js');
  await mkdir(join(directory,'node_modules/wrangler/bin'),{recursive:true});
  const helper=new URL('../scripts/d1.mjs',import.meta.url).href;
  const run=source=>spawnSync(process.execPath,['--input-type=module','-e',`import {d1} from ${JSON.stringify(helper)};${source}`],{cwd:directory,encoding:'utf8'});
  await writeFile(cli,"console.log('├ Checking if file needs uploading\\n[{\"success\":true}]');");
  const success=run("await d1({remote:true}).file('SELECT 1;');");
  assert.equal(success.status,0,success.stderr);
  assert.equal(await readFile(join(directory,'.private/multi-user-migration.sql'),'utf8'),'SELECT 1;');
  await writeFile(cli,"console.error('private-query-details');process.exit(1);");
  const failure=run("await d1({remote:true}).file('SELECT 1;');");
  assert.notEqual(failure.status,0);
  assert.match(failure.stderr,/keep maintenance enabled/);
  assert.doesNotMatch(failure.stderr,/private-query-details/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
