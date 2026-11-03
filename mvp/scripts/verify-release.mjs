import {createHash} from 'node:crypto';
import {setTimeout} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
export async function checkRelease(base,expected,fetcher=fetch){
 const root=new URL(base);
 const manifest=await fetcher(new URL('/release.json?release='+expected,root),{cache:'no-store'});
 if(!manifest.ok)throw new Error('Release manifest is not available');
 const metadata=await manifest.json();if(metadata.release!==expected)throw new Error('The live site still serves a different release');
 const version=await fetcher(new URL('/api/version',root),{cache:'no-store'});
 if(!version.ok||(await version.json()).release!==expected)throw new Error('The live Worker still runs a different release');
 for(const [file,hash] of Object.entries(metadata.assets)){
  if(!/^[\w.-]+$/.test(file)||!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid release asset manifest');
  const response=await fetcher(new URL('/'+file+'?release='+expected,root),{cache:'no-store'});
  if(!response.ok||createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex')!==hash)throw new Error(`Live asset differs: ${file}`);
 }
 const home=await fetcher(root,{cache:'no-store'});if(home.status!==200)throw new Error('The live homepage failed');
 const privateData=await fetcher(new URL('/api/state',root));if(privateData.status!==401)throw new Error('Private API protection check failed');
 return metadata;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [base,release]=process.argv.slice(2);if(!base||!release)throw new Error('Usage: node scripts/verify-release.mjs URL RELEASE');
 let lastError;
 // Deployment acceptance does not guarantee every edge already serves the new files.
 for(let attempt=0;attempt<20;attempt++){
  try{await checkRelease(base,release);console.log(`Verified live release ${release}: assets, homepage and private API.`);process.exit(0);}catch(error){lastError=error;console.log(`Waiting for live release (${attempt+1}/20): ${error.message}`);}
  if(attempt<19)await setTimeout(15000);
 }
 throw lastError;
}
