import {readFile,writeFile,mkdir} from 'node:fs/promises';
const [email,ownerFlag]=process.argv.slice(2);
if(!email||!/^\S+@\S+\.\S+$/.test(email))throw new Error('Usage: node scripts/provision-user.mjs invited@email [--owner]');
const config=JSON.parse(await readFile('.private/auth.json','utf8'));
const secret=process.env.SUPABASE_SECRET_KEY||config.secretKey;
if(!secret)throw new Error('Set SUPABASE_SECRET_KEY locally from Supabase Project Settings > API Keys. Never put it in chat or Git.');
const origin=new URL(config.url);if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co'))throw new Error('Invalid Auth project');
// Pre-admit invited identities so OTP works with public sign-ups disabled; login still requires the mailbox code.
const response=await fetch(new URL('/auth/v1/admin/users',origin),{method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({email:email.trim().toLowerCase(),email_confirm:true}),signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Could not provision the invited identity. Check the Auth project; no planner mapping was changed.');
const user=await response.json();if(!user.id||user.email?.toLowerCase()!==email.toLowerCase())throw new Error('Provider did not return the expected identity');
await mkdir('.private',{recursive:true});
const id=ownerFlag==='--owner'?'legacy-owner':crypto.randomUUID();
const quote=value=>"'"+value.replaceAll("'","''")+"'";
await writeFile(`.private/invite-${id}.json`,JSON.stringify({id,subject:user.id,email:user.email}),{mode:0o600});
if(ownerFlag==='--owner'){console.log('Owner identity prepared. Run the reviewed maintenance migration before activating it.');}
else{
 const sql=`INSERT INTO users (id,auth_subject,email) VALUES (${quote(id)},${quote(user.id)},${quote(user.email.toLowerCase())});`;
 const file=`.private/invite-${id}.sql`;await writeFile(file,sql,{mode:0o600});
 console.log(`Identity prepared. Apply ${file} to the intended D1 database to admit this user.`);
}
