import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
await mkdir('.private',{recursive:true});let secrets;
try{secrets=JSON.parse(await readFile('.private/secrets.json','utf8'));}catch{
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'}),priv=privateKey.export({format:'jwk'});
 secrets={APP_PASSWORD:`um-${randomBytes(15).toString('base64url')}`,AUTH_SECRET:randomBytes(32).toString('base64url'),VAPID_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'),VAPID_PRIVATE_KEY:priv.d,VAPID_SUBJECT:'https://spectrum.um.edu.my/'};
 await writeFile('.private/secrets.json',JSON.stringify(secrets),{mode:0o600});await writeFile('.private/PLANNER_ACCESS.txt',`Student Manager private passphrase\n\n${secrets.APP_PASSWORD}\n\nUse this only on your Student Manager app. It is unrelated to your UM password.\n`,{mode:0o600});
}
const deploymentURL=process.env.PLANNER_URL;
if(!deploymentURL)throw new Error('Set PLANNER_URL to your deployed Worker URL.');
secrets.VAPID_SUBJECT=deploymentURL.endsWith('/')?deploymentURL:deploymentURL+'/';
await writeFile('.private/secrets.json',JSON.stringify(secrets),{mode:0o600});
const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','secret','bulk'],{input:JSON.stringify(secrets),encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exitCode=r.status||0;
