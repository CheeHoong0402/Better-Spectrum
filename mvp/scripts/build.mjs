import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const git=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
const release=process.env.APP_RELEASE||process.env.GITHUB_SHA||(git.status===0?git.stdout.trim():'development');
if(!/^[\w.-]{1,100}$/.test(release))throw new Error('Invalid release identifier');
const sw=await readFile('src/service-worker.js','utf8');
await writeFile('public/sw.js',sw.replaceAll('__APP_RELEASE__',release));
const assets={};
for(const entry of (await readdir('public',{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
 if(entry.isFile()&&entry.name!=='release.json')assets[entry.name]=createHash('sha256').update(await readFile('public/'+entry.name)).digest('hex');
}
await writeFile('public/release.json',JSON.stringify({release,assets})+'\n');
console.log(`Built release ${release} (${Object.keys(assets).length} public files).`);
