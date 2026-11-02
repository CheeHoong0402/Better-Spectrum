export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export const unb64 = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
export async function digest(s){return b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
async function key(secret,algo){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),algo,false,algo==='AES-GCM'?['encrypt','decrypt']:['sign','verify']);}
export async function sign(s,secret){return b64(await crypto.subtle.sign('HMAC',await key(secret,{name:'HMAC',hash:'SHA-256'}),new TextEncoder().encode(s)));}
export async function session(request,secret){
 const value=request.headers.get('Cookie')?.match(/(?:^|;\s*)sm_session=([^;]+)/)?.[1];
 if(!value||!secret)return false;
 const [exp,mac]=value.split('.');if(!mac||Number(exp)<Date.now())return false;
 try{return await crypto.subtle.verify('HMAC',await key(secret,{name:'HMAC',hash:'SHA-256'}),unb64(mac),new TextEncoder().encode(exp));}catch{return false;}
}
export async function seal(text,secret){const iv=crypto.getRandomValues(new Uint8Array(12));return `${b64(iv)}.${b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret,'AES-GCM'),new TextEncoder().encode(text)))}`;}
export async function unseal(text,secret){const [iv,data]=text.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await key(secret,'AES-GCM'),unb64(data)));}
export function validPush(s){try{const u=new URL(s.endpoint);return u.protocol==='https:'&&!u.port&&(/(^|\.)push\.apple\.com$/.test(u.hostname)||u.hostname==='fcm.googleapis.com'||u.hostname==='updates.push.services.mozilla.com')&&unb64(s.keys.p256dh).length===65&&unb64(s.keys.auth).length===16;}catch{return false;}}
export function validDate(s){return typeof s==='string'&&Number.isFinite(Date.parse(s))&&/([+-]\d{2}:\d{2}|Z)$/.test(s);}
