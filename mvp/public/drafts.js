let prefix='planner-draft:unowned:';
const memory=new Map();
export function setDraftUser(userId){
 memory.clear();prefix='planner-draft:'+(userId||'unowned')+':';
 try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key.startsWith('planner-draft:')&&!key.startsWith(prefix))sessionStorage.removeItem(key);}}catch{storageAvailable=false;}
}
let storageAvailable=true;
export function readDraft(key){
 if(memory.has(key))return structuredClone(memory.get(key));
 try{const value=sessionStorage.getItem(prefix+key);if(value)return JSON.parse(value);}catch{storageAvailable=false;}
 return memory.get(key)||null;
}
export function writeDraft(key,value){
 memory.set(key,structuredClone(value));
 try{sessionStorage.setItem(prefix+key,JSON.stringify(value));}catch{storageAvailable=false;}
}
export function deleteDraft(key){memory.delete(key);try{sessionStorage.removeItem(prefix+key);}catch{storageAvailable=false;}}
export function clearDrafts(){
 memory.clear();try{for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key.startsWith(prefix))sessionStorage.removeItem(key);}}catch{storageAvailable=false;}
}
export function draftsNeedWarning(){return !storageAvailable&&memory.size>0;}
