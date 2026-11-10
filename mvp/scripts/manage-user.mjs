import {pathToFileURL} from 'node:url';
import {d1} from './d1.mjs';
export async function manageUser(DB,id,action){
 if(typeof id!=='string'||!id||!['suspend','remove'].includes(action))throw new Error('Choose one existing user and suspend or remove.');
 if(!await DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first())throw new Error('User not found.');
 const statements=[DB.prepare("UPDATE users SET status='suspended',generation=generation+1 WHERE id=?").bind(id),DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),DB.prepare('DELETE FROM subscriptions WHERE user_id=?').bind(id),DB.prepare('DELETE FROM jobs WHERE user_id=?').bind(id),DB.prepare('DELETE FROM attendance_pairings WHERE user_id=?').bind(id)];
 if(action==='remove')statements.push(DB.prepare('DELETE FROM users WHERE id=?').bind(id));
 await DB.batch(statements);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [action,id]=process.argv.slice(2);await manageUser(d1({remote:true}),id,action);console.log('Selected user '+(action==='remove'?'removed from the live database; private backups follow their retention policy.':'suspended; sessions, devices and queued work revoked.'));
}
