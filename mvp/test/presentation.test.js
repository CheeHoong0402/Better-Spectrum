import {test} from 'node:test';
import assert from 'node:assert/strict';
import {plainText,courseLabel,taskGroup,orderedTasks} from '../public/presentation.js';

test('entity decoding sends only isolated tokens to the browser parser and does not parse imported markup',()=>{
 const previous=globalThis.document,tokens=[];
 globalThis.document={createElement:()=>({set innerHTML(entity){tokens.push(entity);this.value=({'&amp;':'&','&nbsp;':'\u00a0','&#233;':'é','&lt;':'<','&gt;':'>'})[entity]||entity;}})};
 try{
  assert.equal(plainText('Caf&#233;&nbsp;&amp; notes'),'Café\u00a0& notes');
  assert.equal(plainText('&lt;script&gt;bad&lt;/script&gt; <img src=x>'),'<script>bad</script> <img src=x>');
  assert.ok(tokens.every(token=>/^&[^<>\s]+;$/.test(token)));
  assert.equal(courseLabel('ABC101','ABC101 Introduction to AI'),'Introduction to AI');
  assert.equal(courseLabel('ABC101','ABC1010 Research'),'ABC1010 Research');
 }finally{globalThis.document=previous;}
});
test('deadline groups preserve completion, distinguish invalid dates and use instants at MYT boundaries',()=>{
 const now=Date.parse('2026-11-07T00:00:00+08:00');
 assert.equal(taskGroup({due:'2026-11-06T15:59:59Z'},now),'overdue');
 assert.equal(taskGroup({due:'2026-11-06T16:00:00Z'},now),'upcoming');
 assert.equal(taskGroup({due:'invalid'},now),'unverified');
 for(const status of ['done','submitted'])assert.equal(taskGroup({due:'2020-01-01',status},now),'completed');
 for(const status of ['draft','unknown'])assert.equal(taskGroup({due:'2030-01-01',status},now),'upcoming');
 const rows=[{id:'z',due:'2030-01-02'},{id:'b',due:'2030-01-01'},{id:'a',due:'2030-01-01'},{id:'bad',due:'invalid'}];
 assert.deepEqual(orderedTasks(rows).map(t=>t.id),['a','b','z','bad']);assert.equal(rows[0].id,'z');
});
