import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
function run(args){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)throw new Error('Local HTTP test setup failed');}
run(['scripts/local-setup.mjs']);run(['scripts/build.mjs']);
const directory=await mkdtemp(join(tmpdir(),'better-spectrum-http-'));
const wrangler='node_modules/wrangler/bin/wrangler.js';
run([wrangler,'d1','execute','DB','--local','--file','schema.sql','--persist-to',directory]);
const origin='http://127.0.0.1:8791';
const server=spawn(process.execPath,[wrangler,'dev','--ip','127.0.0.1','--port','8791','--persist-to',directory],{stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',data=>{logs+=data;});server.stderr.on('data',data=>{logs+=data;});
try{
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  if(server.exitCode!==null)throw new Error('Local server exited before starting');
  await setTimeout(500);
 }
 if(!ready)throw new Error('Local server did not become ready');
 const result=spawnSync(process.execPath,['scripts/smoke.mjs'],{stdio:'inherit',env:{...process.env,SMOKE_ORIGIN:origin}});
 if(result.status!==0)throw new Error('HTTP smoke tests failed');
}catch(error){console.error(logs.slice(-4000));throw error;}
finally{
 if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});
 else server.kill('SIGTERM');
}
