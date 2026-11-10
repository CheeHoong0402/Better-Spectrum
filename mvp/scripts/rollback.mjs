import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
export function compatibleRollback(version){
 if(!/^multi-user-schema-4:[a-f0-9]{40}$/.test(version?.annotations?.['workers/message']||''))throw new Error('Rollback refused: choose a tagged multi-user schema-4 release. Old ownerless code is incompatible.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const id=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(id||''))throw new Error('Supply the reviewed Cloudflare version ID.');
 const cli='node_modules/wrangler/bin/wrangler.js',config=['--config','wrangler.production.jsonc'];
 const read=spawnSync(process.execPath,[cli,'versions','view',id,...config,'--json'],{encoding:'utf8'});if(read.status!==0)throw new Error('Could not inspect the rollback version.');compatibleRollback(JSON.parse(read.stdout));
 const result=spawnSync(process.execPath,[cli,'rollback',id,...config,'--yes'],{stdio:'inherit'});process.exitCode=result.status??1;
}
