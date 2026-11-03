import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {backupSql} from '../scripts/backup.mjs';

test('private backup restores quoted text, null values, numbers and indexes',()=>{
 const schema=[{type:'table',name:'records',sql:'CREATE TABLE records (id TEXT PRIMARY KEY, title TEXT, amount INTEGER, optional TEXT)'},{type:'index',name:'title_idx',sql:'CREATE INDEX title_idx ON records(title)'}];
 const rows=[{id:'one',title:"O'Brien\nLecture",amount:15,optional:null}];
 const db=new DatabaseSync(':memory:');
 try{db.exec(backupSql(schema,{records:rows}));assert.deepEqual({...db.prepare('SELECT * FROM records').get()},rows[0]);assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE name='title_idx'").get());}finally{db.close();}
});
