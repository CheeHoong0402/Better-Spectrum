import {sealCredential,unseal} from '../src/security.js';
import {call} from '../src/moodle.js';
const credentials=['moodle_token','attendance_mobile','attendance_cookie'];
const known=/^(moodle_token|planner_owner|connection|courses|course_catalog|last_sync|last_tick|manual_sync_index|seeded|attendance_(?:enabled|cookie|connection|mobile|checked|error|renew_after|qr_after|login_after)|credentials_version|(?:course_scope|scope_baseline|scope_membership|baseline|sync_round|synced|partial|forum_baseline|removed|sync-error):.*)$/;
export function validateLegacySettings(rows){
 const unknown=rows.filter(row=>!known.test(row.key)&&!(/^(?:login:|spectrum-login-|delivery-lock:)/.test(row.key)||['attendance_lock','attendance_pair'].includes(row.key)));
 if(unknown.length)throw new Error('Legacy settings contain unclassified keys. Review them before migration.');
}
export async function activateOwner(DB,{subject,email,oldSecret,dataKey}){
 if(!subject||!email||!oldSecret||!dataKey)throw new Error('Verified owner identity and both encryption keys are required.');
 const owner=await DB.prepare("SELECT * FROM users WHERE id='legacy-owner' AND status='suspended' AND auth_subject IS NULL").first();
 if(!owner)throw new Error('Legacy owner is missing or already activated.');
 const rows=(await DB.prepare("SELECT key,value FROM user_settings WHERE user_id='legacy-owner'").all()).results;
 validateLegacySettings(rows);
 const env={DB:{userId:'legacy-owner'},DATA_ENCRYPTION_KEY:dataKey},changes=[];
 let pinned=rows.find(r=>r.key==='planner_owner')?.value;
 for(const row of rows.filter(r=>credentials.includes(r.key))){const value=await unseal(row.value,oldSecret);
  if(row.key==='moodle_token'){const info=await call(value,'core_webservice_get_site_info');if(!Number.isSafeInteger(info.userid)||info.userid<1||(pinned&&String(info.userid)!==pinned))throw new Error('Existing course connection does not match the legacy owner.');pinned=String(info.userid);}
  changes.push(DB.prepare("UPDATE user_settings SET value=? WHERE user_id='legacy-owner' AND key=?").bind(await sealCredential(env,row.key,value),row.key));}
 if(pinned&&!/^[1-9]\d*$/.test(pinned))throw new Error('Legacy university owner is invalid.');
 changes.push(DB.prepare("INSERT INTO user_settings (user_id,key,value) VALUES ('legacy-owner','attendance_enabled','0') ON CONFLICT(user_id,key) DO UPDATE SET value='0'"));
 changes.push(DB.prepare("UPDATE user_settings SET value='2' WHERE user_id='legacy-owner' AND key='credentials_version'"));
 changes.push(DB.prepare("UPDATE users SET auth_subject=?,email=?,moodle_site=?,moodle_user_id=?,status='active' WHERE id='legacy-owner' AND status='suspended' AND auth_subject IS NULL").bind(subject,email.toLowerCase(),pinned?'https://spectrum.um.edu.my':null,pinned?Number(pinned):null));
 await DB.batch(changes);
}
