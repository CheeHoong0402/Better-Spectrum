import {createHash,timingSafeEqual} from 'node:crypto';
import {b64,digest,seal,unseal,sign} from './security.js';
import {setting,call} from './moodle.js';
import {RecordError} from './records.js';

const site='https://spectrum.um.edu.my',scheme='betterspectrumlogin';
export const spectrumOnly=env=>env.PLANNER_LOGIN==='spectrum';
export const plannerSessionKey=env=>env.AUTH_SECRET+(spectrumOnly(env)?':spectrum-v1':'');
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const flowCookie=(value,age=600)=>`sm_spectrum=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
export function mobileLoginToken(callback,passport){
 if(typeof callback!=='string'||callback.length>3000)throw new RecordError('SPeCTRUM returned an invalid sign-in reply.',401);
 const match=callback.match(/^betterspectrumlogin:\/\/token=([a-zA-Z0-9+/%=_-]+)\/?$/i);
 if(!match)throw new RecordError('SPeCTRUM returned an unexpected sign-in link.',401);
 let parts;try{parts=Buffer.from(decodeURIComponent(match[1]).replace(/\/$/,''),'base64').toString('utf8').split(':::');}catch{throw new RecordError('SPeCTRUM returned an invalid sign-in reply.',401);}
 const expected=createHash('md5').update(site+passport).digest('hex');
 if(!/^[a-f0-9]{32}$/i.test(parts[0]||'')||!timingSafeEqual(Buffer.from(parts[0].toLowerCase()),Buffer.from(expected))||![2,3].includes(parts.length)||!/^[a-zA-Z0-9]{16,128}$/.test(parts[1]||''))throw new RecordError('This reply does not match the sign-in you started.',401);
 return parts[1];
}
async function limit(request,env){
 const key='spectrum-login-limit:'+await digest((request.headers.get('CF-Connecting-IP')||'local')+env.AUTH_SECRET),now=Date.now();
 const row=await env.DB.prepare("INSERT INTO settings (key,value) VALUES (?,json_object('n',1,'until',?)) ON CONFLICT(key) DO UPDATE SET value=json_object('n',CASE WHEN json_extract(value,'$.until')<? THEN 1 ELSE json_extract(value,'$.n')+1 END,'until',CASE WHEN json_extract(value,'$.until')<? THEN ? ELSE json_extract(value,'$.until') END) RETURNING value").bind(key,now+900000,now,now,now+900000).first();
 if(JSON.parse(row.value).n>16)throw new RecordError('Too many sign-in attempts. Try again in 15 minutes.',429);
}
export async function spectrumLogin(request,env,data,finish=false){
 if(!spectrumOnly(env))throw new RecordError('SPeCTRUM planner sign-in is not enabled.',404);
 await limit(request,env);
 if(!finish){
  if(!await setting(env.DB,'planner_owner')&&!await setting(env.DB,'moodle_token'))throw new RecordError('The planner owner must be configured before SPeCTRUM sign-in can open this planner.',503);
  const flow={challenge:random(),passport:random(),expires:Date.now()+600000};
  const url=new URL(site+'/admin/tool/mobile/launch.php');url.search=new URLSearchParams({service:'moodle_mobile_app',passport:flow.passport,urlscheme:scheme});
  return Response.json({challenge:flow.challenge,url:url.href},{headers:{'Cache-Control':'no-store','Set-Cookie':flowCookie(await seal(JSON.stringify(flow),env.AUTH_SECRET))}});
 }
 let flow;try{const cookie=request.headers.get('Cookie')?.match(/(?:^|;\s*)sm_spectrum=([^;]+)/)?.[1];flow=JSON.parse(await unseal(cookie,env.AUTH_SECRET));}catch{throw new RecordError('Start SPeCTRUM sign-in again on this device.',401);}
 if(flow.expires<Date.now()||!data.challenge||data.challenge!==flow.challenge)throw new RecordError('This sign-in expired or belongs to another device. Start again.',401);
 const token=mobileLoginToken(data.callback,flow.passport);
 let info;try{info=await call(token,'core_webservice_get_site_info');}catch{throw new RecordError('SPeCTRUM could not verify this sign-in. Try again.',401);}
 if(!Number.isSafeInteger(info.userid)||info.userid<1)throw new RecordError('SPeCTRUM did not identify your account.',401);
 let owner=await setting(env.DB,'planner_owner');
 if(!owner){
  const saved=await setting(env.DB,'moodle_token');
  if(!saved)throw new RecordError('The planner owner has not been configured.',503);
  let existing;try{existing=await call(await unseal(saved,env.AUTH_SECRET),'core_webservice_get_site_info');}catch{throw new RecordError('The existing course connection must be renewed before the first planner sign-in.',503);}
  if(!Number.isSafeInteger(existing.userid)||existing.userid!==info.userid)throw new RecordError('Use the SPeCTRUM account that owns this planner.',403);
  await env.DB.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)').bind('planner_owner',String(existing.userid)).run();
  owner=await setting(env.DB,'planner_owner');
 }
 if(String(info.userid)!==owner)throw new RecordError('Use the SPeCTRUM account that owns this planner.',403);
 const used=await env.DB.prepare('INSERT OR IGNORE INTO settings (key,value) VALUES (?,?) RETURNING key').bind('spectrum-login-used:'+await digest(flow.challenge),String(flow.expires)).first();
 if(!used)throw new RecordError('This sign-in has already been used. Start again.',401);
 // Retain the verified token, never a university password, so an expired course connection can recover.
 await setting(env.DB,'moodle_token',await seal(token,env.AUTH_SECRET));
 const exp=String(Date.now()+30*86400000),headers=new Headers({'Cache-Control':'no-store'});
 headers.append('Set-Cookie',`sm_session=${exp}.${await sign(exp,plannerSessionKey(env))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`);
 headers.append('Set-Cookie',flowCookie('',0));
 await env.DB.prepare("DELETE FROM settings WHERE key LIKE 'spectrum-login-used:%' AND CAST(value AS INTEGER)<?").bind(Date.now()).run();
 return Response.json({ok:true},{headers});
}
