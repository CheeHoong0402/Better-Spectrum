export function notificationPanel(){
 return `<section class="panel"><p class="eyebrow">PHONE NOTIFICATIONS</p><h2>Reminders on this device.</h2><div id="device-push" role="status">Checking this device’s notification setup…</div><details><summary>Delivery details</summary><p class="subtle">Delivery history for this device. Push-service acceptance does not confirm that a notification appeared on your screen.</p><button class="quiet" id="delivery-status" disabled>View delivery status for this device</button><div id="deliveries"></div></details></section>`;
}
export function notificationSwitch(icon){
 return `<label class="settings-row attendance-toggle">${icon('bell')}<span>Notifications</span><input id="notifications-enabled" type="checkbox" role="switch" disabled aria-describedby="notifications-hint"></label><p class="subtle attendance-help" id="notifications-hint" hidden></p>`;
}

export async function inspectNotifications(state,{navigator,Notification,PushManager,api}){
 if(!Notification||!PushManager||!navigator.serviceWorker)return {status:'unsupported'};
 const reg=await navigator.serviceWorker.getRegistration(),sub=reg&&await reg.pushManager.getSubscription();
 if(Notification.permission==='denied')return {status:'blocked',sub};
 if(!state.pushReady||!state.pushKey)return {status:'unavailable',sub};
 if(Notification.permission!=='granted'||!sub)return {status:'setup',sub};
 const saved=await api('push-status',{endpoint:sub.endpoint});
 return {status:saved.subscribed?'enabled':'setup',sub};
}

export function bindNotifications(state,{api,load,action,toast}){
 const box=document.querySelector('#device-push'),toggle=document.querySelector('#notifications-enabled');if(!box&&!toggle)return;
 let device;
 const check=async()=>{
  if(!box?.isConnected&&!toggle?.isConnected)return;
  try{device=await inspectNotifications(state,{navigator,Notification:window.Notification,PushManager:window.PushManager,api});}
  catch{device={status:'error'};}
  if(toggle?.isConnected){
   toggle.checked=device.status==='enabled';toggle.disabled=!['setup','enabled'].includes(device.status);
   const hint=document.querySelector('#notifications-hint'),messages={unsupported:'Notifications are unavailable here.',unavailable:'Notifications are not configured.',error:'Could not check notifications.'};
   hint.textContent=messages[device.status]||'';hint.hidden=!hint.textContent;
   if(!hint.hidden){const link=document.createElement('a');link.href='#settings/notifications';link.textContent=' Details';hint.append(link);}
  }
  if(!box?.isConnected)return;
  const messages={unsupported:'Notifications are unavailable in this browser. On iPhone, open this app in Safari, choose Share → Add to Home Screen, then open the installed app.',blocked:'Notification permission is blocked. Allow notifications for this app in your browser or device settings, then check again.',unavailable:'Notifications need to be configured for your planner. Your device has not been confirmed ready.',setup:'Notifications need setup on this device. Permission or a subscription on another device does not enable this one.',enabled:'Notifications are enabled on this device. Send a test to check that they appear on your screen.',error:'Could not check this device’s setup. Check your connection and try again.'};
  box.textContent=messages[device.status];
  const buttons=document.createElement('div');buttons.className='actions';box.append(buttons);
  const button=(id,text,fn)=>{const b=document.createElement('button');b.id=id;b.textContent=text;b.onclick=()=>action(fn,b);buttons.append(b);};
  if(device.status==='setup')button('enable-push','Enable on this device',async()=>{try{await setEnabled(true);toast('Notifications on.');}finally{await check();}});
  if(device.sub)button('disable-push','Disable on this device',async()=>{try{await setEnabled(false);toast('Notifications off.');}finally{await check();}});
  if(device.status==='enabled'){
   for(const [id,delayed,text] of [['test-push',false,'Send test to this device'],['delay-push',true,'Test this device in 2 minutes']])button(id,text,async()=>{const r=await api('push-test',{delayed,endpoint:device.sub.endpoint});toast(r.message);});
   const note=document.createElement('p');note.className='subtle';note.textContent='For the delayed test, close the app and check this device after two minutes. Delivery depends on your connection and notification settings.';box.append(note);
  }
  button('check-push','Check setup again',check);
  const deliveries=document.querySelector('#delivery-status');deliveries.disabled=!device.sub;
  deliveries.onclick=()=>action(async()=>{
   const rows=await api('deliveries',{endpoint:device.sub.endpoint}),target=document.querySelector('#deliveries');target.replaceChildren();
   for(const row of rows){const line=document.createElement('p');line.className='delivery';line.textContent=`${new Date(row.due).toLocaleString('en-GB',{timeZone:'Asia/Kuala_Lumpur'})} · ${row.sent?'Accepted by push service':row.error?'Delivery failed: '+row.error:'Queued'} · attempts ${row.attempts}`;target.append(line);}
   if(!rows.length)target.textContent='No deliveries for this device yet.';
  },deliveries,'Checking deliveries…',true);
 };
 const setEnabled=async enabled=>{
  if(enabled){
   const permission=await window.Notification.requestPermission();if(permission!=='granted')throw Error('Allow notifications in your device settings.');
   const reg=await navigator.serviceWorker.getRegistration();if(!reg?.active)throw Error('Refresh the app and try again.');
   const raw=atob(state.pushKey.replace(/-/g,'+').replace(/_/g,'/')),key=Uint8Array.from(raw,c=>c.charCodeAt(0));
   const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
   await api('subscribe',sub.toJSON());
  }else if(device.sub){await api('unsubscribe',{endpoint:device.sub.endpoint});await device.sub.unsubscribe();}
 };
 toggle?.addEventListener('change',async event=>{
  const enabled=event.target.checked;toggle.checked=device?.status==='enabled';
  await action(async()=>{await setEnabled(enabled);toast(enabled?'Notifications on.':'Notifications off.');},toggle,'Updating notifications…');
  await check();
 });
 return check();
}
