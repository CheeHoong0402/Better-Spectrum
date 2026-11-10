export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function digest(s){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
async function key(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),'AES-GCM',false,['encrypt','decrypt']);}
export async function session(request,DB){
 const value=cookie(request,'__Host-sm_session');
 if(!value||!/^[A-Za-z0-9_-]{43}$/.test(value))return null;
 return DB.prepare("SELECT u.*,s.id AS session_id,s.device_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires>? AND u.status='active'").bind(await digest(value),Date.now()).first();
}
export const cookie=(request,name)=>request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
export const randomToken=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export async function seal(text,secret,context=''){const iv=crypto.getRandomValues(new Uint8Array(12));return `${b64(iv)}.${b64(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await key(secret),new TextEncoder().encode(text)))}`;}
export async function unseal(text,secret,context=''){const [iv,data]=text.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:new TextEncoder().encode(context)},await key(secret),unb64(data)));}
export const sealCredential=(env,purpose,text)=>seal(text,env.DATA_ENCRYPTION_KEY,`${env.DB.userId}:${purpose}`);
export const unsealCredential=(env,purpose,text)=>unseal(text,env.DATA_ENCRYPTION_KEY,`${env.DB.userId}:${purpose}`);
export function validPush(s){try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.port&&(/(^|\.)push\.apple\.com$/.test(u.hostname)||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com')&&unb64(s.keys.p256dh).length===65&&unb64(s.keys.auth).length===16;}catch{return false;}}
export function validDate(s){return typeof s==='string'&&Number.isFinite(Date.parse(s))&&/([+-]\d{2}:\d{2}|Z)$/.test(s);}
