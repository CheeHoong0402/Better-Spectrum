import {createServer} from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';

const planner='https://um-student-manager.campus-planner-a19743.workers.dev';
const site='https://spectrum.um.edu.my';
const scheme='betterspectrum-attendance';
const directory=join(dirname(fileURLToPath(import.meta.url)),'../.private/attendance-helper');
const stateFile=join(directory,'listener.json');
export function parseCallback(value,passport){
 if(typeof value!=='string'||value.length>3000)throw Error('Invalid sign-in callback.');
 const match=value.match(/^betterspectrum-attendance:\/\/token=([a-zA-Z0-9+/%=_-]+)\/?$/i);if(!match)throw Error('Unexpected sign-in callback.');
 const encoded=decodeURIComponent(match[1]).replace(/\/$/,'');
 if(!/^[a-zA-Z0-9+/=_-]+$/.test(encoded))throw Error('Invalid sign-in reply.');
 const parts=Buffer.from(encoded,'base64').toString('utf8').split(':::');
 const expected=createHash('md5').update(site+passport).digest('hex');
 if(!/^[a-f0-9]{32}$/i.test(parts[0]||'')||!timingSafeEqual(Buffer.from(parts[0].toLowerCase()),Buffer.from(expected)))throw Error('This reply does not match the sign-in you started.');
 if(parts.length!==3||!/^[a-zA-Z0-9]{16,128}$/.test(parts[1]||'')||!/^[a-zA-Z0-9]{16,128}$/.test(parts[2]||''))throw Error('Moodle did not return a private token. Sign out of SPeCTRUM in the chosen browser, generate a new pairing code, and retry a fresh SPeCTRUM sign-in.');
 return {token:parts[1],privateToken:parts[2]};
}
function powershell(code){
 const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true});
 if(r.status!==0)throw Error('Windows could not set up the sign-in helper.');
}
const quote=s=>"'"+s.replaceAll("'","''")+"'";
function protocol(mode){
 const command=`"${process.execPath}" "${fileURLToPath(import.meta.url)}" --callback "%1"`;
 const root=`HKCU:\\Software\\Classes\\${scheme}`;
 powershell(`$ErrorActionPreference='Stop'; $root=${quote(root)}; $cmd=${quote(command)}; if(Test-Path -LiteralPath $root){$old=(Get-ItemProperty -LiteralPath ($root+'\\shell\\open\\command') -ErrorAction SilentlyContinue).'(default)'; if($old -ne $cmd){throw 'A different application owns this protocol'}}; `+(mode==='remove'?`if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}`:`New-Item -Path ($root+'\\shell\\open\\command') -Force | Out-Null; Set-Item -LiteralPath $root -Value 'Better Spectrum attendance sign-in'; New-ItemProperty -LiteralPath $root -Name 'URL Protocol' -Value '' -Force | Out-Null; Set-Item -LiteralPath ($root+'\\shell\\open\\command') -Value $cmd`));
}
function open(url,privateWindow=false){
 // A fresh Moodle login is required to receive the private token; a previous browser session may omit it.
 powershell(privateWindow?`Start-Process -FilePath 'msedge.exe' -ArgumentList @('--inprivate',${quote(url)})`:`Start-Process ${quote(url)}`);
}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>5000)throw Error('Request too large.');}return text;}
async function callback(value){
 const state=JSON.parse(await readFile(stateFile,'utf8'));if(state.expires<Date.now()||!Number.isInteger(state.port)||state.port<1024||state.port>65535)throw Error('Helper session expired.');
 const r=await fetch(`http://127.0.0.1:${state.port}/callback`,{method:'POST',headers:{'Content-Type':'application/json','X-Helper-Key':state.key},body:JSON.stringify({url:value}),signal:AbortSignal.timeout(120000)});
 if(!r.ok)throw Error('The helper could not accept that callback.');
}
export async function startHelper({openPage=true}={}){
 if(process.platform!=='win32')throw Error('This helper currently supports Windows only.');
 await mkdir(directory,{recursive:true});
 try{const previous=JSON.parse(await readFile(stateFile,'utf8'));if(previous.expires>Date.now())throw Error('A helper session is already open. Use that window or wait for it to expire.');await rm(stateFile,{force:true});}catch(e){if(e.code!=='ENOENT')throw e;}
 protocol('install');
 const key=randomBytes(32).toString('hex'),expires=Date.now()+15*60000;
 let passport='',code='',result='Ready. Generate a pairing code in your planner, then paste it below.',busy=false,done=false;
 const page=()=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Better Spectrum sign-in helper</title><h1>Connect attendance through Microsoft</h1><p>This setup only reads an attendance report. Auto-marking stays off.</p><p>${result.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><form method="post" action="/start"><input type="hidden" name="key" value="${key}"><label>Planner pairing code <input name="code" required maxlength="72" autocomplete="off" size="50"></label><label>Sign-in browser <select name="browser"><option value="default">Your usual browser (recommended)</option><option value="edge-private">Edge InPrivate</option></select></label><button ${busy||done?'disabled':''}>Sign in with Microsoft</button></form><p>Microsoft opens in your selected browser. If you are already signed into SPeCTRUM there, sign out of SPeCTRUM first so Moodle can issue the private token. Complete sign-in and allow the link to open this helper. Return here and refresh for the result.</p><p>No Microsoft password is read or saved by this helper. Moodle credentials are sent only to your configured private planner.</p><a href="${planner}/#settings/timetable" rel="noreferrer">Open planner Settings</a>`;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const local=`http://127.0.0.1:${server.address().port}`;
  try{
   if(req.headers.host!==new URL(local).host)throw Error('Unexpected helper host.');
   if(req.method==='GET'&&req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page());return;}
   if(req.method==='POST'&&req.url==='/start'){
    if(req.headers.origin!==local)throw Error('Unexpected request origin.');
    const data=new URLSearchParams(await body(req));if(data.get('key')!==key||busy||done)throw Error('This helper session is not ready.');
    code=data.get('code')||'';if(!/^[a-f0-9-]{72}$/.test(code))throw Error('Paste the pairing code from your planner.');
    const browser=data.get('browser')||'default';if(!['default','edge-private'].includes(browser))throw Error('Choose a supported sign-in browser.');
    passport=randomBytes(24).toString('hex');busy=true;
    const url=new URL(site+'/admin/tool/mobile/launch.php');url.search=new URLSearchParams({service:'moodle_mobile_app',passport,urlscheme:scheme}).toString();
    try{open(url.href,browser==='edge-private');}catch(e){busy=false;throw e;}
    result='Waiting for Microsoft sign-in. This window expires after 15 minutes.';res.writeHead(303,{Location:'/'});res.end();return;
   }
   if(req.method==='POST'&&req.url==='/callback'){
    if(req.headers['x-helper-key']!==key||!busy||done||Date.now()>expires)throw Error('Callback session expired or was already used.');
    const credentials=parseCallback(JSON.parse(await body(req)).url,passport);busy=false;done=true;
    try{
     const r=await fetch(planner+'/api/attendance-handoff',{method:'POST',headers:{Origin:planner,'Content-Type':'application/json'},body:JSON.stringify({code,...credentials}),signal:AbortSignal.timeout(110000)});
     const answer=await r.json();if(!r.ok)throw Error(answer.error||'The planner could not verify this connection.');
     result=`Connected. Cloud read-only test passed for ${answer.verified.course}: ${answer.verified.rows} report rows. Auto-marking remains OFF. Open planner Settings to continue.`;
    }catch(e){done=false;result=String(e.message).slice(0,350)+' Generate a new pairing code to try again.';}
    code='';passport='';res.end('Accepted');return;
   }
   res.writeHead(404);res.end('Not found');
  }catch(e){if(req.url==='/callback'){result='Sign-in failed: '+e.message;busy=false;}res.writeHead(400,{'Content-Type':'text/plain; charset=utf-8'});res.end(e.message);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await writeFile(stateFile,JSON.stringify({port:server.address().port,key,expires}),{mode:0o600,flag:'wx'});
 const local=`http://127.0.0.1:${server.address().port}/`;if(openPage)open(local);console.log('Attendance sign-in helper opened. Keep this process running during sign-in. It expires in 15 minutes.');
 async function cleanup(){clearTimeout(timer);server.closeAllConnections();server.close();await rm(stateFile,{force:true});try{protocol('remove');}catch{} }
 const timer=setTimeout(()=>cleanup(),15*60000);process.once('SIGINT',async()=>{clearTimeout(timer);await cleanup();});
 return {server,cleanup};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv[2]==='--callback')await callback(process.argv[3]);else await startHelper();}catch{console.error('Attendance helper could not finish. Check the local helper page, or start a new helper session.');process.exitCode=1;}
}
