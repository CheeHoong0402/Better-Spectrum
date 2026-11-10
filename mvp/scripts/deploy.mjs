import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir,appendFile} from 'node:fs/promises';
const config=JSON.parse(await readFile('wrangler.production.jsonc','utf8'));
if(config.name.endsWith('-local')||config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')throw new Error('Configure the existing production Worker and database first.');
const base=process.env.PLANNER_URL||config.vars?.PLANNER_URL;if(!base||new URL(base).protocol!=='https:')throw new Error('Set the production PLANNER_URL.');
function node(args,capture=false){
 const result=spawnSync(process.execPath,args,{encoding:'utf8',stdio:capture?'pipe':'inherit',maxBuffer:32*1024*1024});
 if(result.status!==0)throw new Error(capture?result.stderr:`Command failed: ${args.slice(0,3).join(' ')}`);
 return result.stdout;
}
const release=process.env.GITHUB_SHA||spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim();
if(!/^[a-f0-9]{40}$/.test(release))throw new Error('Deploy a committed Git release.');
const dirty=spawnSync('git',['status','--porcelain'],{encoding:'utf8'});if(dirty.status!==0||dirty.stdout.trim())throw new Error('Commit the working tree before deploying.');
process.env.APP_RELEASE=release;
node(['scripts/build.mjs']);
const wrangler=['node_modules/wrangler/bin/wrangler.js'];
const previous=JSON.parse(node([...wrangler,'deployments','status','--config','wrangler.production.jsonc','--json'],true));
await mkdir('.private/releases',{recursive:true});
await writeFile(`.private/releases/${release}.json`,JSON.stringify({release,url:base,previousDeployment:previous},null,2),{mode:0o600});
node(['scripts/database-ready.mjs']);
node(['scripts/backup.mjs','wrangler.production.jsonc']);
node([...wrangler,'d1','migrations','apply','DB','--remote','--config','wrangler.production.jsonc']);
node([...wrangler,'deploy','--config','wrangler.production.jsonc','--message',`multi-user-schema-4:${release}`,'--var',`APP_RELEASE:${release}`]);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`Deployed commit: ${release}\n\nPrevious versions for rollback: ${previous.versions.map(v=>v.version_id).join(', ')}\n`);
node(['scripts/verify-release.mjs',base,release]);
