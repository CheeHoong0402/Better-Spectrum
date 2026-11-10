import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {userDatabase,userEnvironment} from '../src/tenant.js';
import {digest,randomToken} from '../src/security.js';
export function database({strict=false}={}){
 const sqlite=new DatabaseSync(':memory:');
 // Legacy single-user fixtures explicitly belong to this test identity.
 const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
 sqlite.exec(strict?schema:schema.replaceAll('user_id TEXT NOT NULL REFERENCES','user_id TEXT NOT NULL DEFAULT \'test-user\' REFERENCES').replace('device_id TEXT, UNIQUE','device_id TEXT DEFAULT \'test-device\', UNIQUE'));
 sqlite.exec("INSERT INTO users (id,auth_subject,email) VALUES ('test-user','test-subject','student@example.com')");
 sqlite.exec("INSERT INTO subscriptions (user_id,id,value,device_id) VALUES ('test-user','device','{}','test-device')");
 const raw=sqliteAdapter(sqlite);
 const scoped=userDatabase(raw,'test-user');
 const DB={...scoped,prepare(sql){return sql.startsWith('WITH owner')?scoped.prepare(sql):raw.prepare(sql);},batch(statements){return raw.batch(statements.map(s=>s.statement||s));}};
 return {sqlite,DB,raw};
}
export function testEnvironment(DB,extra={}){
 const raw=DB.raw||DB;
 return userEnvironment({...extra,DB:raw,DATA_ENCRYPTION_KEY:'test-data-secret'}, {id:'test-user',email:'student@example.com',generation:0,...extra.user});
}
export async function testCookie(DB,userId='test-user',deviceId='test-device'){
 const raw=DB.raw||DB,token=randomToken();
 await raw.prepare('INSERT INTO sessions (id,user_id,device_id,expires) VALUES (?,?,?,?)').bind(await digest(token),userId,deviceId,Date.now()+3600000).run();
 return '__Host-sm_session='+token;
}
export const testWorker=worker=>({fetch(request,env){
 const headers=new Headers(request.headers);if(headers.has('Cookie')&&!headers.has('X-Planner-User'))headers.set('X-Planner-User','test-user');
 return worker.fetch(new Request(request,{headers}),{DATA_ENCRYPTION_KEY:'test-data-secret',...env,DB:env.database||env.DB.raw||env.DB});
}});

export function sqliteAdapter(sqlite){
 return {prepare(sql){let args=[];const execute=method=>{try{const statement=sqlite.prepare(sql);if(/\?\d/.test(sql)){const named=Object.fromEntries(args.map((v,i)=>[String(i+1),v]));return statement[method](named);}return statement[method](...args);}catch(error){error.message+=' SQL: '+sql;throw error;}};return {bind(...values){args=values;return this;},async first(){return execute('get')||null;},async all(){return {results:execute('all')};},async run(){if(/\bRETURNING\b/i.test(sql)){const results=execute('all');return {results,meta:{changes:results.length}};}const result=execute('run');return {results:[],meta:{changes:result.changes}};}};},async batch(statements){
  sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}
 }};
}
