import {randomToken} from './security.js';
import {userEnvironment} from './tenant.js';
import {RecordError} from './records.js';

export async function schedule(env,userId,kind,target='',now=Date.now()){
 await env.DB.prepare("INSERT INTO jobs (id,user_id,kind,target,generation,due) SELECT ?,id,?,?,generation,? FROM users WHERE id=? AND status='active' ON CONFLICT(user_id,kind,target) DO UPDATE SET due=min(jobs.due,excluded.due),attempts=CASE WHEN jobs.status='failed' THEN 0 ELSE jobs.attempts END,status=CASE WHEN jobs.status='failed' THEN 'pending' ELSE jobs.status END").bind(`${userId}:${kind}:${target}`,kind,String(target),now,userId).run();
}
export async function dispatch(env,now=Date.now()){
 if(env.MAINTENANCE==='1')return;
 if(!env.JOBS)throw new Error('Background queue is not configured.');
 await env.DB.batch([
  env.DB.prepare("INSERT INTO jobs (id,user_id,kind,target,generation,due) SELECT u.id||':sync:'||json_extract(c.value,'$.id'),u.id,'sync',CAST(json_extract(c.value,'$.id') AS TEXT),u.generation,? FROM users u JOIN user_settings s ON s.user_id=u.id AND s.key='courses' JOIN user_settings token ON token.user_id=u.id AND token.key='moodle_token',json_each(s.value) c WHERE u.status='active' AND json_extract(c.value,'$.id') IS NOT NULL ON CONFLICT(user_id,kind,target) DO NOTHING").bind(now),
  env.DB.prepare("INSERT INTO jobs (id,user_id,kind,generation,due) SELECT u.id||':attendance:',u.id,'attendance',u.generation,? FROM users u JOIN user_settings s ON s.user_id=u.id AND s.key='attendance_enabled' AND s.value='1' WHERE u.status='active' ON CONFLICT(user_id,kind,target) DO NOTHING").bind(now),
  env.DB.prepare("INSERT INTO jobs (id,user_id,kind,generation,due) SELECT u.id||':reminders:',u.id,'reminders',u.generation,? FROM users u WHERE u.status='active' AND (EXISTS(SELECT 1 FROM tasks t WHERE t.user_id=u.id AND t.remind_at<=? AND t.status NOT IN ('done','submitted') AND t.due>?) OR EXISTS(SELECT 1 FROM classes c WHERE c.user_id=u.id AND c.remind_at<=? AND c.ends>?)) ON CONFLICT(user_id,kind,target) DO NOTHING").bind(now,now,new Date(now).toISOString(),now,new Date(now).toISOString()),
  env.DB.prepare("INSERT INTO jobs (id,user_id,kind,target,generation,due) SELECT DISTINCT d.user_id||':deliver:'||d.subscription_id,d.user_id,'deliver',d.subscription_id,u.generation,? FROM deliveries d JOIN users u ON u.id=d.user_id WHERE u.status='active' AND d.sent IS NULL AND d.attempts<5 AND d.due<=? ON CONFLICT(user_id,kind,target) DO NOTHING").bind(now,new Date(now).toISOString()),
  env.DB.prepare("UPDATE jobs SET generation=(SELECT generation FROM users WHERE id=jobs.user_id),status='pending',lease=NULL,lease_until=NULL,attempts=0 WHERE generation<>(SELECT generation FROM users WHERE id=jobs.user_id)"),
  env.DB.prepare('DELETE FROM auth_attempts WHERE expires<?').bind(now),
  env.DB.prepare('DELETE FROM auth_limits WHERE expires<?').bind(now),
  env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
  env.DB.prepare("DELETE FROM jobs WHERE kind='deliver' AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id=jobs.user_id AND s.id=jobs.target)"),
  env.DB.prepare('DELETE FROM deliveries WHERE rowid IN (SELECT rowid FROM deliveries WHERE sent IS NOT NULL AND sent<? LIMIT 1000)').bind(new Date(now-7*86400000).toISOString())
 ]);
 const rows=(await env.DB.prepare("SELECT j.id,j.generation FROM jobs j JOIN users u ON u.id=j.user_id WHERE u.status='active' AND j.due<=? AND (j.status='pending' OR (j.status='running' AND j.lease_until<?)) ORDER BY j.due,j.id LIMIT 100").bind(now,now).all()).results;
 if(rows.length)await env.JOBS.sendBatch(rows.map(body=>({body})));
}
export async function withUserLease(env,user,fn){
 const token=randomToken(),now=Date.now();
 const claim=await env.DB.prepare('INSERT INTO user_leases (user_id,token,expires) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET token=excluded.token,expires=excluded.expires WHERE user_leases.expires<? RETURNING token').bind(user.id,token,now+180000,now).first();
 if(!claim)throw new RecordError('Your planner is checking a connection. Try again shortly.',409);
 try{return await fn(userEnvironment(env,{...user,lease:token}));}
 finally{await env.DB.prepare('DELETE FROM user_leases WHERE user_id=? AND token=?').bind(user.id,token).run();}
}
export async function consume(batch,env,execute){
 for(const message of batch.messages){
  if(env.MAINTENANCE==='1'){message.retry({delaySeconds:60});continue;}
  const data=message.body;
  if(typeof data?.id!=='string'||!Number.isSafeInteger(data.generation)){message.ack();continue;}
  const token=randomToken(),now=Date.now();
  const job=await env.DB.prepare("UPDATE jobs SET status='running',lease=?,lease_until=? WHERE id=? AND generation=? AND due<=? AND (status='pending' OR (status='running' AND lease_until<?)) AND EXISTS (SELECT 1 FROM users u WHERE u.id=jobs.user_id AND u.status='active' AND u.generation=jobs.generation) RETURNING *").bind(token,now+180000,data.id,data.generation,now,now).first();
  if(!job){message.ack();continue;}
  try{
   const user=await env.DB.prepare("SELECT * FROM users WHERE id=? AND status='active' AND generation=?").bind(job.user_id,job.generation).first();
   if(user)await withUserLease(env,user,scoped=>execute(scoped,job));
   await env.DB.prepare("UPDATE jobs SET status='pending',due=?,lease=NULL,lease_until=NULL,attempts=0,error=NULL WHERE id=? AND lease=? AND generation=?").bind(Date.now()+(job.kind==='sync'?900000:60000),job.id,token,job.generation).run();
   message.ack();
  }catch(error){
   const busy=error instanceof RecordError&&error.status===409;
   const attempts=error.reconnect?5:job.attempts+(busy?0:1),failed=attempts>=5;
   await env.DB.prepare('UPDATE jobs SET status=?,attempts=?,due=?,lease=NULL,lease_until=NULL,error=? WHERE id=? AND lease=? AND generation=?').bind(failed?'failed':'pending',attempts,Date.now()+Math.min(900000,30000*2**attempts),busy?'Connection busy':'Background check failed',job.id,token,job.generation).run();
   if(error.reconnect)await env.DB.prepare("UPDATE jobs SET status='failed',error='Reconnect SPeCTRUM' WHERE user_id=? AND generation=? AND kind='sync'").bind(job.user_id,job.generation).run();
   if(failed){if(env.DEAD_LETTER)await env.DEAD_LETTER.send({jobId:job.id,userId:job.user_id,kind:job.kind});message.ack();}
   else message.retry({delaySeconds:busy?30:Math.min(900,30*2**attempts)});
  }
 }
}
