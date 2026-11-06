export function attendancePanel(state,{esc,day,time,dateKey,external}){
 const a=state.attendance||{sessions:[]};
 const management=`<details class="attendance-connection" ${a.connected?'':'open'}><summary>${a.connected?'Manage attendance connection':'Connect attendance using QR code'}</summary><p>QR setup is the recommended route and does not mark attendance.</p>${!state.connected?'<p><a href="#settings/connection">Connect your SPeCTRUM courses first →</a></p>':''} <section><h3>Connect with your SPeCTRUM QR code</h3><p>In your signed-in SPeCTRUM tab, refresh your profile → More Details → Mobile app → View QR code. Save the QR image, then choose it below. It expires in 10 minutes.</p><form id="attendance-qr"><label>SPeCTRUM mobile-app QR image<input type="file" name="qr" accept="image/png,image/jpeg,image/webp" required></label><p class="subtle">The image is decoded in this browser. Only the sign-in key is sent to your private planner and SPeCTRUM. An encrypted mobile connection is retained so the cloud can check attendance. Setup only reads a report and leaves auto-marking off. Never share the QR code in chat.</p><button class="primary">Connect using QR code</button><p id="attendance-qr-status" role="status"></p></form></section>
 ${a.connected||a.connection==='Direct sign-in available'?`<details ${!a.connected?'open':''}><summary>${a.connected?'Reconnect attendance':'Connect attendance'}</summary><form id="attendance-login"><label>Siswa email or SPeCTRUM username<input name="username" autocomplete="username" required maxlength="200"></label><label>SPeCTRUM password<input name="password" type="password" autocomplete="off" required maxlength="500"></label><p class="subtle">Used by this private app to sign into spectrum.um.edu.my. Your password is not stored. The encrypted sign-in session is kept on the server; reconnect here if it expires. Use the same student account as course sync.</p><button class="primary">Connect attendance</button></form></details>`:''}
 <details><summary>Alternative Windows sign-in helper</summary><section><h3>Connect through Microsoft</h3><p>On Windows, run the sign-in helper, then generate a pairing code here. Sign in on Microsoft’s own page. The encrypted Moodle connection is kept by your private planner so the cloud can check attendance when your phone is closed. No attendance is marked during setup.</p><button id="attendance-pair">Generate helper pairing code</button><div id="attendance-pair-code" role="status"></div></section></details>
 <div class="actions"><button id="attendance-support">Check connection method</button><a href="https://spectrum.um.edu.my/" target="_blank" rel="noopener noreferrer">Open SPeCTRUM ↗</a></div>
 ${a.connected?'<button class="quiet" id="attendance-disconnect">Disconnect attendance</button>':''}
</details>`;
 return `<section class="attendance-settings"><h2>Attendance assistance</h2>
 <p role="status">Attendance connection: ${esc(a.connection||'Not connected')}</p>${a.error?`<p class="notice" role="status">${esc(a.error)}</p>`:''}
 ${!a.connected?management:''}
 <label class="attendance-toggle"><span>Auto-mark attendance<small>${a.enabled?'On · marks matching saved classes automatically':'Off'}</small></span><input id="attendance-enabled" type="checkbox" role="switch" ${a.enabled?'checked':''} ${!a.connected?'disabled':''} aria-describedby="attendance-rules"></label>
 <form id="attendance-check" class="attendance-check"><label>Check sessions for<select name="courseId" required><option value="">Choose a course</option>${state.courses.filter(c=>c.id!=null&&c.code!=='WIX1003').map(c=>`<option value="${esc(c.id)}">${esc(c.code)}</option>`).join('')}</select></label><button ${!a.connected?'disabled':''}>Check sessions</button></form>
 <p class="subtle">Shows today and tomorrow. When auto-marking is on, matching sessions are marked during your saved class times. No separate class confirmation is needed.</p>
 <h3>Today and tomorrow’s sessions</h3>
 ${a.sessions.length?[...a.sessions].sort((x,y)=>x.day.localeCompare(y.day)).map(s=>{
  const classes=state.classes.filter(c=>c.course===s.course&&dateKey(c.starts)===s.day&&Date.parse(c.ends)>Date.now());
  const skipped=s.message==='Skipped by you',canSkip=a.enabled&&s.day===dateKey(new Date())&&!s.recorded&&!s.manual&&!s.attempted&&!skipped&&s.course!=='WIX1003'&&classes.length;
  const message=s.recorded?'Verified in SPeCTRUM':s.message;
  return `<article class="task attendance-session"><div class="task-meta"><strong>${esc(s.course)}</strong><span>${s.recorded?esc(s.recorded):s.manual?'Manual marking':skipped?'Skipped':s.confirmed_class?'Scheduled automatically':s.attempted?'Needs a manual check':s.session_id?'Open':'Waiting to open'}</span></div><h4>${s.day===dateKey(new Date())?'Today':esc(day(s.day+'T12:00:00+08:00'))} · ${esc(s.name)}</h4><p>${esc(s.label)}</p>${message?`<p class="subtle">${esc(message)}</p>`:''}
   <div class="task-actions">${external(`https://spectrum.um.edu.my/mod/attendance/view.php?id=${s.cmid}`,'Open attendance')}${canSkip?`<button data-attendance-cancel="${esc(s.id)}" class="quiet">Skip this session</button>`:''}</div></article>`;
 }).join(''):'<p class="empty">No sessions have been found yet. Check a course, or let automatic checks find sessions near your saved class times. Enable the switch to mark matching sessions automatically.</p>'}
 ${a.connected?management:''}
 <details class="attendance-rules"><summary>Attendance rules and reminders</summary>
 <p id="attendance-rules">With the switch on, the server checks about every two minutes and marks an open session when its course, date, start and end match one saved class. No separate confirmation is needed. Turn this off or skip a session when you will not attend. Turning this off clears pending matches. A request already sent may still finish.</p>
 <p><strong>WIX1003 lectures and tutorials stay manual.</strong> Password, QR code and network-restricted sessions also need you to mark in SPeCTRUM. ${state.courses.find(c=>c.code==='WIX1003')?.id?external(`https://spectrum.um.edu.my/course/view.php?id=${state.courses.find(c=>c.code==='WIX1003').id}`,'Open WIX1003'):''}</p>
 <p>After a recorded result is verified, we send a push notification. <a href="#settings/notifications">Enable phone notifications →</a></p>
</details>
 </section>`;
}
export function bindAttendance({api,load,action,toast}){
 document.querySelector('#attendance-qr')?.addEventListener('submit',e=>{e.preventDefault();const f=e.target,file=f.elements.qr.files[0];action(async()=>{const status=document.querySelector('#attendance-qr-status');status.textContent='Reading QR image…';try{const url=await readAttendanceQr(file);status.textContent='Checking your cloud connection. No attendance is being marked…';const r=await api('attendance-qr',{url});await load();toast(`Connected. Read-only report verified for ${r.verified.course}. Auto-marking is still off.`);}catch(error){status.textContent=error.message;throw error;}finally{f.reset();}});});
 document.querySelector('#attendance-pair')?.addEventListener('click',()=>action(async()=>{const r=await api('attendance-pair',{});const box=document.querySelector('#attendance-pair-code');box.replaceChildren();const input=document.createElement('input');input.readOnly=true;input.value=r.code;input.setAttribute('aria-label','Pairing code for Windows helper');box.append(input);const p=document.createElement('p');p.textContent='Copy this into the local Windows helper. Expires in 10 minutes; one use. Keep it private.';box.append(p);input.select();}));
 document.querySelector('#attendance-support')?.addEventListener('click',()=>action(async()=>{const r=await api('attendance-support',{});await load();toast(r.supported?'Direct sign-in is available. Enter your details below.':r.message);}));
 document.querySelector('#attendance-enabled')?.addEventListener('change',e=>action(async()=>{const enabled=e.target.checked;e.target.disabled=true;try{await api('attendance-enabled',{enabled});toast(enabled?'Auto-marking enabled for matching saved class times.':'Auto-marking off. Pending matches cleared.');}finally{await load();}}));
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
