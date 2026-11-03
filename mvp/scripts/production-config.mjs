import {readFile,writeFile} from 'node:fs/promises';
const {WORKER_NAME,D1_DATABASE_ID,CLOUDFLARE_ACCOUNT_ID,PLANNER_URL}=process.env;
if(!WORKER_NAME||!D1_DATABASE_ID||!CLOUDFLARE_ACCOUNT_ID||!PLANNER_URL)throw new Error('Set WORKER_NAME, D1_DATABASE_ID, CLOUDFLARE_ACCOUNT_ID and PLANNER_URL in repository variables.');
if(!/^[\w-]+$/.test(WORKER_NAME)||!/^https:\/\//.test(PLANNER_URL)||!/^\w{32}$/.test(CLOUDFLARE_ACCOUNT_ID)||!/^[a-f0-9-]{36}$/.test(D1_DATABASE_ID)||D1_DATABASE_ID==='00000000-0000-0000-0000-000000000000')throw new Error('Invalid production configuration');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
config.name=WORKER_NAME;config.account_id=CLOUDFLARE_ACCOUNT_ID;config.d1_databases[0].database_id=D1_DATABASE_ID;config.vars={PLANNER_URL};
await writeFile('wrangler.production.jsonc',JSON.stringify(config,null,2)+'\n');
