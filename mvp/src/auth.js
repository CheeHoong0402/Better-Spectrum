import {cookie,digest,randomToken,session} from './security.js';
import {RecordError} from './records.js';
const json=(v,status=200,headers={})=>Response.json(v,{status,headers:{'Cache-Control':'no-store',...headers}});
export const sessionCookie=(value,age=2592000)=>`__Host-sm_session=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const flowCookie=(value,age=600)=>`__Host-sm_login=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export async function authLimit(env,id,max=8){
 const now=Date.now(),key=await digest(id);
 const row=await env.DB.prepare('INSERT INTO auth_limits (id,n,expires) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET n=CASE WHEN expires<? THEN 1 ELSE n+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING n').bind(key,now+900000,now,now).first();
 if(row.n>max)throw new RecordError('Too many attempts. Try again in 15 minutes.',429);
}
async function provider(env,path,data){
 let origin;try{origin=new URL(env.SUPABASE_URL);if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co')||origin.pathname!=='/'||origin.username||origin.password)throw new Error();}catch{throw new RecordError('Email sign-in is not configured yet.',503);}
 if(!env.SUPABASE_PUBLISHABLE_KEY)throw new RecordError('Email sign-in is not configured yet.',503);
 let response;try{response=await fetch(new URL('/auth/v1/'+path,origin),{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});}catch{throw new RecordError('Email sign-in is temporarily unavailable.',503);}
 if(!response.ok)throw new RecordError(path==='verify'?'That code expired or was not recognised.':'Could not send a sign-in code. Try again shortly.',path==='verify'?401:503);
 return response.json();
}
export async function authenticate(request,env,data,finish){
 await authLimit(env,'ip:'+(request.headers.get('CF-Connecting-IP')||'local'),200);
 if(!finish){
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))throw new RecordError('Enter your invited email address.');
  await authLimit(env,'email:'+email,8);
  const user=await env.DB.prepare("SELECT id FROM users WHERE email=? AND status='active' AND auth_subject IS NOT NULL").bind(email).first();
  const challenge=randomToken();
  if(user)await provider(env,'otp',{email,create_user:false});
  await env.DB.prepare('INSERT INTO auth_attempts (id,user_id,expires) VALUES (?,?,?)').bind(await digest(challenge),user?.id||null,Date.now()+600000).run();
  return json({ok:true,message:'If this email is invited, a sign-in code is on its way.'},200,{'Set-Cookie':flowCookie(challenge)});
 }
 const challenge=cookie(request,'__Host-sm_login');
 if(!challenge||!/^\d{8}$/.test(data.code||''))throw new RecordError('Start sign-in and enter the eight-digit email code.',401);
 await authLimit(env,'flow:'+await digest(challenge),8);
 const flow=await env.DB.prepare("SELECT a.id,u.id AS user_id,u.email,u.auth_subject FROM auth_attempts a JOIN users u ON u.id=a.user_id WHERE a.id=? AND a.expires>? AND a.claimed=0 AND u.status='active'").bind(await digest(challenge),Date.now()).first();
 if(!flow)throw new RecordError('Start sign-in again. This attempt is unavailable or expired.',401);
 const result=await provider(env,'verify',{email:flow.email,token:data.code,type:'email'});
 if(result.user?.id!==flow.auth_subject||!result.user?.email_confirmed_at)throw new RecordError('This identity is not invited to this planner.',403);
 const token=randomToken(),device=randomToken(),now=Date.now();
 // Claim and session creation share a transaction; concurrent replies cannot both succeed.
 const inserted=await env.DB.batch([
  env.DB.prepare("UPDATE auth_attempts SET claimed=1 WHERE id=? AND claimed=0 AND expires>? AND EXISTS (SELECT 1 FROM users WHERE id=? AND status='active') RETURNING id").bind(flow.id,now,flow.user_id),
  env.DB.prepare("INSERT INTO sessions (id,user_id,device_id,expires) SELECT ?,?,?,? WHERE changes()=1").bind(await digest(token),flow.user_id,device,now+2592000000)
 ]);
 if(!inserted[0].results?.length&&!inserted[0].meta?.changes&&!inserted[0].changes)throw new RecordError('This sign-in was already used. Start again.',401);
 return json({ok:true,user:{id:flow.user_id,email:flow.email}},200,{'Set-Cookie':sessionCookie(token)});
}
export async function logout(request,env,user){
 await env.DB.batch([
  env.DB.prepare('DELETE FROM subscriptions WHERE user_id=? AND device_id=?').bind(user.id,user.device_id),
  env.DB.prepare('DELETE FROM sessions WHERE id=? AND user_id=?').bind(user.session_id,user.id)
 ]);
 return json({ok:true},200,{'Set-Cookie':sessionCookie('',0)});
}
export {session};
