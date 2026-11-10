export const ownerSQL=`WITH owner AS (SELECT id FROM users WHERE id=json_extract(?1,'$.id') AND generation=json_extract(?1,'$.generation') AND status='active' AND (json_extract(?1,'$.lease') IS NULL OR EXISTS (SELECT 1 FROM user_leases WHERE user_id=users.id AND token=json_extract(?1,'$.lease') AND expires>unixepoch('now')*1000)))`;
// Queries declare ?1 as their owner; this binds it without rewriting SQL.
export function userDatabase(database,userId,generation=0,lease=null){
 if(typeof userId!=='string'||!userId)throw new Error('A verified planner owner is required.');
 return {userId,raw:database,prepare(sql){
  if(!sql.includes('?1'))throw new Error('Personal queries must declare their owner.');
  const statement=database.prepare(sql);
  const owner=JSON.stringify({id:userId,generation,lease});
  let bound=statement.bind(owner);
  return {bind(...values){bound=statement.bind(owner,...values);return this;},first(...args){return bound.first(...args);},all(){return bound.all();},run(){return bound.run();},get statement(){return bound;}};
 },batch(statements){return database.batch(statements.map(s=>s.statement));}};
}
export function userEnvironment(env,user){
 if(!env.DATA_ENCRYPTION_KEY)throw new Error('Data encryption is not configured.');
 return {...env,database:env.DB,DB:userDatabase(env.DB,user.id,user.generation,user.lease),userId:user.id,user};
}
