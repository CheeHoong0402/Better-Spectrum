import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkRelease} from '../scripts/verify-release.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
test('release verification rejects old releases, mismatched assets and exposed private data',async()=>{
 const release='test-release';
 function mock({old=false,asset='new icon',privateStatus=401}={}){return async url=>{
  const path=new URL(url).pathname;
  if(path==='/release.json')return Response.json({release:old?'old':release,assets:{'icon.svg':hash('new icon')}});
  if(path==='/api/version')return Response.json({release});
  if(path==='/icon.svg')return new Response(asset);
  if(path==='/api/state')return new Response('',{status:privateStatus});
  return new Response('homepage');
 };}
 await checkRelease('https://test.example',release,mock());
 await assert.rejects(checkRelease('https://test.example',release,mock({old:true})),/different release/);
 await assert.rejects(checkRelease('https://test.example',release,mock({asset:'old icon'})),/asset differs/);
 await assert.rejects(checkRelease('https://test.example',release,mock({privateStatus:200})),/protection/);
});
