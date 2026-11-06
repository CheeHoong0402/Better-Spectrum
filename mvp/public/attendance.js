export function attendanceSwitch(state){
 const a=state.attendance||{};
 return `<label class="settings-row attendance-toggle"><span>Auto-mark attendance</span><input id="attendance-enabled" type="checkbox" role="switch" ${a.enabled?'checked':''} ${!a.connected?'disabled':''} aria-describedby="attendance-help"></label><p class="subtle attendance-help" id="attendance-help">${a.connected?'Uses your saved timetable.': '<a href="#settings/connection">Connect attendance to enable.</a>'}</p>`;
}
export function attendanceConnection(state,{esc}){
 const a=state.attendance||{};
 return `<section class="attendance-settings"><h2>Attendance connection</h2><p role="status">${esc(a.connection||'Not connected')}</p>${a.error?`<p class="notice" role="status">${esc(a.error)}</p>`:''}
 <details class="attendance-connection" ${a.connected?'':'open'}><summary>${a.connected?'Manage connection':'Connect attendance'}</summary>
 ${!state.connected?'<p>Connect your SPeCTRUM courses first.</p>':''}
 <p>SPeCTRUM profile → More Details → Mobile app → View QR code. Codes expire after 10 minutes.</p>
 <form id="attendance-qr"><label>QR image<input type="file" name="qr" accept="image/png,image/jpeg,image/webp" required></label><p class="subtle">Setup leaves auto-marking off. Your QR image stays on this device.</p><button class="primary">Connect using QR code</button><p id="attendance-qr-status" role="status"></p></form>
 ${a.connected||a.connection==='Direct sign-in available'?`<details ${!a.connected?'open':''}><summary>Password sign-in</summary><form id="attendance-login"><label>Siswa email or username<input name="username" autocomplete="username" required maxlength="200"></label><label>SPeCTRUM password<input name="password" type="password" autocomplete="off" required maxlength="500"></label><p class="subtle">Use the same account as course sync. Your password is not saved.</p><button class="primary">Connect attendance</button></form></details>`:''}
 <details><summary>Windows sign-in helper</summary><p>Run the Windows helper, then paste the pairing code into it.</p><button id="attendance-pair">Generate pairing code</button><div id="attendance-pair-code" role="status"></div></details>
 <div class="actions"><button id="attendance-support">Check sign-in method</button><a href="https://spectrum.um.edu.my/" target="_blank" rel="noopener noreferrer">Open SPeCTRUM ↗</a></div>
 ${a.connected?'<button class="quiet" id="attendance-disconnect">Disconnect attendance</button>':''}
 </details></section>`;
}
export function attendancePanel(state,{esc,day,time,dateKey,external}){
 const a=state.attendance||{sessions:[]};
 return `<section class="attendance-settings"><h2>Attendance</h2>
 ${a.error?`<p class="notice" role="status">${esc(a.error)}</p>`:''}
 ${!a.connected?'<p><a href="#settings/connection">Connect attendance →</a></p>':''}
 <form id="attendance-check" class="attendance-check"><label>Course<select name="courseId" required><option value="">Choose a course</option>${state.courses.filter(c=>c.id!=null&&c.code!=='WIX1003').map(c=>`<option value="${esc(c.id)}">${esc(c.code)}</option>`).join('')}</select></label><button ${!a.connected?'disabled':''}>Check sessions</button></form>
 <h3>Today & tomorrow</h3>
 ${a.sessions.length?[...a.sessions].sort((x,y)=>x.day.localeCompare(y.day)).map(s=>{
  const classes=state.classes.filter(c=>c.course===s.course&&dateKey(c.starts)===s.day&&Date.parse(c.ends)>Date.now());
  const skipped=s.message==='Skipped by you',canSkip=a.enabled&&s.day===dateKey(new Date())&&!s.recorded&&!s.manual&&!s.attempted&&!skipped&&s.course!=='WIX1003'&&classes.length;
  const message=s.recorded?'Verified in SPeCTRUM':s.message;
  return `<article class="task attendance-session"><div class="task-meta"><strong>${esc(s.course)}</strong><span>${s.recorded?esc(s.recorded):s.manual?'Manual marking':skipped?'Skipped':s.confirmed_class?'Scheduled automatically':s.attempted?'Needs a manual check':s.session_id?'Open':'Waiting to open'}</span></div><h4>${s.day===dateKey(new Date())?'Today':esc(day(s.day+'T12:00:00+08:00'))} · ${esc(s.name)}</h4><p>${esc(s.label)}</p>${message?`<p class="subtle">${esc(message)}</p>`:''}
   <div class="task-actions">${external(`https://spectrum.um.edu.my/mod/attendance/view.php?id=${s.cmid}`,'Open attendance')}${canSkip?`<button data-attendance-cancel="${esc(s.id)}" class="quiet">Skip this session</button>`:''}</div></article>`;
 }).join(''):'<p class="empty">No sessions found.</p>'}
 </section>`;
}
export function bindAttendance({api,load,action,toast}){
 document.querySelector('#attendance-qr')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target,file=f.elements.qr.files[0];action(async()=>{const status=document.querySelector('#attendance-qr-status');status.textContent='Reading QR image…';try{const url=await readAttendanceQr(file);status.textContent='Connecting…';await api('attendance-qr',{url});await load();toast(`Attendance connected. Auto-marking is off.`);}catch(error){status.textContent=error.message;throw error;}finally{f.reset();}});});
 document.querySelector('#attendance-pair')?.addEventListener('click',()=>action(async()=>{const r=await api('attendance-pair',{});const box=document.querySelector('#attendance-pair-code');box.replaceChildren();const input=document.createElement('input');input.readOnly=true;input.value=r.code;input.setAttribute('aria-label','Pairing code for Windows helper');box.append(input);const p=document.createElement('p');p.textContent='Paste into the Windows helper. Expires in 10 minutes; keep private.';box.append(p);input.select();}));
 document.querySelector('#attendance-support')?.addEventListener('click',()=>action(async()=>{const r=await api('attendance-support',{});await load();toast(r.supported?'Sign-in available.':r.message);}));
 document.querySelector('#attendance-enabled')?.addEventListener('change',e=>action(async()=>{const enabled=e.target.checked;e.target.disabled=true;try{await api('attendance-enabled',{enabled});toast(enabled?'Auto-marking on.':'Auto-marking off.');}finally{await load();}}));
 document.querySelector('#attendance-login')?.addEventListener('submit',e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));e.target.elements.password.value='';action(async()=>{try{await api('attendance-connect',data);toast('Attendance connected. You can now enable auto-marking.');}finally{await load();}});});
 document.querySelector('#attendance-disconnect')?.addEventListener('click',()=>action(async()=>{await api('attendance-disconnect',{});await load();}));
 document.querySelector('#attendance-check')?.addEventListener('submit',e=>{e.preventDefault();const courseId=new FormData(e.target).get('courseId');action(async()=>{await api('attendance-refresh',{courseId:Number(courseId)});await load();toast('Attendance sessions checked.');});});
 document.querySelectorAll('[data-attendance-cancel]').forEach(b=>b.addEventListener('click',()=>action(async()=>{await api('attendance-cancel',{id:b.dataset.attendanceCancel});await load();})));
}


export async function readAttendanceQr(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024)throw Error('Choose a PNG, JPEG or WebP QR image under 4 MB.');
 await import('./qr-decoder.js');
 let image;try{image=await createImageBitmap(file);}catch{throw Error('The QR image could not be opened. Save the QR code as a PNG and try again.');}
 try{
  if(image.width>10000||image.height>10000)throw Error('Choose a smaller image showing only the QR code.');
  const scale=Math.min(1,1400/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  const result=globalThis.jsQR(pixels.data,pixels.width,pixels.height,{inversionAttempts:'attemptBoth'});
  if(!result?.data)throw Error('No QR code found. Use a clear image of the SPeCTRUM mobile-app QR code.');return result.data;
 }finally{image.close();}
}
