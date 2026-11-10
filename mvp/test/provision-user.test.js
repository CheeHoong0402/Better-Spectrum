import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('invited owner can use OTP with sign-ups disabled without receiving a password',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'planner-invite-'));
 try{
  await mkdir(join(directory,'.private'));
  await writeFile(join(directory,'.private/auth.json'),JSON.stringify({url:'https://test-project.supabase.co',secretKey:'test-secret'}));
  const script=new URL('../scripts/provision-user.mjs',import.meta.url).href;
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
   import assert from 'node:assert/strict';
   process.argv=['node','provision-user.mjs','owner@example.com','--owner'];
   globalThis.fetch=async(url,options)=>{
    assert.equal(String(url),'https://test-project.supabase.co/auth/v1/admin/users');
    assert.equal(options.method,'POST');
    assert.deepEqual(JSON.parse(options.body),{email:'owner@example.com',email_confirm:true});
    return Response.json({id:'owner-subject',email:'owner@example.com'});
   };
   await import(${JSON.stringify(script)});
  `],{cwd:directory,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(directory,'.private/invite-legacy-owner.json'),'utf8')),{id:'legacy-owner',subject:'owner-subject',email:'owner@example.com'});
 }finally{await rm(directory,{recursive:true,force:true});}
});
