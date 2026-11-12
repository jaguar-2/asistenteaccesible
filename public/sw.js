self.addEventListener('push',event=>{
  let data={};
  try{if(event.data)data=event.data.json()}catch(e){data={body:event.data?.text()||'Aviso de simulación'}}
  event.waitUntil(self.registration.showNotification(data.title||'AsistenteAccesible',{
    body:data.body||'Aviso de simulación',icon:'/icon.svg',badge:'/icon.svg',
    tag:'aa-notice-'+Date.now(),renotify:true,vibrate:[200,100,200],
    data:{url:data.url||'/'},timestamp:Date.now()
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url||'/'));
});
