import {digest,randomToken} from '../src/security.js';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
function run(args){const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.status!==0)throw new Error('Local HTTP test setup failed');}
run(['scripts/local-setup.mjs']);run(['scripts/build.mjs']);
const directory=await mkdtemp(join(tmpdir(),'better-spectrum-http-'));
const wrangler='node_modules/wrangler/bin/wrangler.js';
run([wrangler,'d1','execute','DB','--local','--file','schema.sql','--persist-to',directory]);
const tokens=[randomToken(),randomToken()];
const seed=`INSERT INTO users (id,auth_subject,email) VALUES ('smoke-a','subject-a','a@example.com'),('smoke-b','subject-b','b@example.com');
INSERT INTO sessions (id,user_id,device_id,expires) VALUES ('${await digest(tokens[0])}','smoke-a','device-a',${Date.now()+3600000}),('${await digest(tokens[1])}','smoke-b','device-b',${Date.now()+3600000});
INSERT INTO jobs (id,user_id,kind,generation,due) VALUES ('smoke-a:reminders:','smoke-a','reminders',0,0);`;
const seedPath=join(directory,'seed.sql');await writeFile(seedPath,seed,{mode:0o600});
run([wrangler,'d1','execute','DB','--local','--file',seedPath,'--persist-to',directory]);
for(const [port,script,vars] of [['8791','smoke.mjs',[]],['8792','auth-smoke.mjs',[]]]){

 const origin='http://127.0.0.1:'+port;
const server=spawn(process.execPath,[wrangler,'dev','--test-scheduled','--ip','127.0.0.1','--port',port,'--persist-to',directory,...vars],{stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',data=>{logs+=data;});server.stderr.on('data',data=>{logs+=data;});
try{
 let ready=false;
 for(let attempt=0;attempt<60;attempt++){
  try{if((await fetch(origin,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break;}}catch{}
  if(server.exitCode!==null)throw new Error('Local server exited before starting');
  await setTimeout(500);
 }
 if(!ready)throw new Error('Local server did not become ready');
 const result=spawnSync(process.execPath,['scripts/'+script],{stdio:'inherit',env:{...process.env,SMOKE_ORIGIN:origin,SMOKE_COOKIE:'__Host-sm_session='+tokens[0],SMOKE_OTHER_COOKIE:'__Host-sm_session='+tokens[1],SMOKE_USER:'smoke-a'}});
 if(result.status!==0)throw new Error('HTTP smoke tests failed');
}catch(error){console.error(logs.slice(-4000));throw error;}
finally{
 if(process.platform==='win32')spawnSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore'});
 else server.kill('SIGTERM');
}
}
