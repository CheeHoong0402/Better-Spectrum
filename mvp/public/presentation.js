export function plainText(value){
 return String(value??'').replace(/&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);/g,entity=>{
  // Only an entity token reaches the decoder; imported markup never reaches HTML parsing.
  const decoder=document.createElement('textarea');decoder.innerHTML=entity;return decoder.value;
 });
}
export function courseLabel(code,name=code){
 const title=plainText(name).trim();
 return title.toLowerCase().startsWith(String(code).toLowerCase()+' ')?title.slice(String(code).length).trim():title;
}
export const pendingTask=t=>!['submitted','done'].includes(t.status);
export function taskGroup(t,now=Date.now()){
 if(!pendingTask(t))return 'completed';
 const due=Date.parse(t.due);return !Number.isFinite(due)?'unverified':due<now?'overdue':'upcoming';
}
export function orderedTasks(tasks){
 return [...tasks].sort((a,b)=>{
  const due=t=>Number.isFinite(Date.parse(t.due))?Date.parse(t.due):Infinity;
  return due(a)-due(b)||String(a.id??'').localeCompare(String(b.id??''));
 });
}
