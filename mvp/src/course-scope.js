export function groupNumbers(text,plainGroup=false){
 const label=String(text||'').replace(/&amp;|&#38;|&#x26;/gi,'&').replace(/&nbsp;|&#160;|&#xa0;/gi,' ').replace(/[–—]/g,'-').replace(/<[^>]*>/g,' ').slice(0,1000);
 const prefix=plainGroup?'OCC(?:URRENCE)?S?(?:\\s*\\/\\s*GROUP)?|TUTORIAL\\s+GROUP|GROUP|T':'OCC(?:URRENCE)?S?(?:\\s*\\/\\s*GROUP)?|TUTORIAL\\s+GROUP|T';
 const pattern=new RegExp(`\\b(?:${prefix})\\s*[:#]?\\s*(\\d{1,3}(?!\\d)(?:\\s*(?:,|&|and|/|-)\\s*(?:(?:${prefix})\\s*)?\\d{1,3}(?!\\d))*)`,'gi');
 const numbers=new Set();
 for(const match of label.matchAll(pattern))for(const part of match[1].matchAll(/(\d+)(?:\s*-\s*(\d+))?/g)){
  const start=Number(part[1]),end=Number(part[2]||part[1]);
  if(start>0&&end>=start&&end-start<100)for(let n=start;n<=end;n++)numbers.add(n);
 }
 return [...numbers];
}

export function courseScope(sections,numbers,config={}){
 const own=new Set(numbers),byId=new Map(sections.map(s=>[String(s.id),s])),parents=new Map(Object.entries(config.parents||{}).map(([id,p])=>[id,String(p)]));
 for(const s of sections)for(const m of s.modules||[])if(m.modname==='subsection'){
  let child;try{child=JSON.parse(m.customdata||'{}').sectionid;}catch{}
  child ||= sections.find(s=>s.component==='mod_subsection'&&String(s.itemid)===String(m.instance))?.id;
  if(child)parents.set(String(child),String(s.id));
 }
 const states=new Map(),visiting=new Set();
 function sectionState(id){
  if(states.has(id))return states.get(id);
  const s=byId.get(id);if(!s||visiting.has(id))return 'shared';
  visiting.add(id);
  let state='shared';
  const parent=parents.get(id);
  if(parent&&parent!=='0')state=sectionState(parent);
  if(s.uservisible===false||s.uservisible===0||s.visible===0)state='blocked';
  const groups=groupNumbers(s.name,true);
  if(state!=='blocked'&&groups.length)state=groups.some(n=>own.has(n))?'own':'blocked';
  visiting.delete(id);states.set(id,state);return state;
 }
 const nodes=[],modules=[];
 for(const s of sections){
  const state=sectionState(String(s.id));
  nodes.push({id:`section:${s.id}`,allowed:state!=='blocked'});
  for(const m of s.modules||[]){
   let decision=state;
   if(m.uservisible===false||m.uservisible===0||m.visible===0)decision='blocked';
   const groups=groupNumbers(m.name);
   if(decision!=='blocked'&&groups.length)decision=groups.some(n=>own.has(n))?'own':'blocked';
   const allowed=decision!=='blocked';
   nodes.push({id:`module:${m.id}`,allowed});
   if(allowed)modules.push(m);
  }
 }
 return {nodes,modules,sections:sections.filter(s=>sectionState(String(s.id))!=='blocked')};
}

export async function allowedScope(DB,id){
 return !!await DB.prepare('SELECT s.id FROM content_scopes s LEFT JOIN content_scopes p ON p.id=s.parent_id WHERE s.id=? AND s.allowed=1 AND (s.parent_id IS NULL OR p.allowed=1)').bind(id).first();
}
