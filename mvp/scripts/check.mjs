import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const directory of ['src','public','scripts'])for(const name of readdirSync(directory)){
 if(!/\.(mjs|js)$/.test(name))continue;
 const result=spawnSync(process.execPath,['--check',`${directory}/${name}`],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
