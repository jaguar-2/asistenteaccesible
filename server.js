'use strict';
const express=require('express'),webpush=require('web-push'),{Pool}=require('pg'),crypto=require('crypto');
const app=express();app.use(express.json({limit:'100kb'}));app.use(express.static('public'));
const PORT=process.env.PORT||3000, TOKEN=process.env.ADMIN_TOKEN||'', PUBLIC=process.env.VAPID_PUBLIC_KEY||'', PRIVATE=process.env.VAPID_PRIVATE_KEY||'';
if(!TOKEN||!PUBLIC||!PRIVATE){console.error('Faltan ADMIN_TOKEN, VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY');process.exit(1)}
webpush.setVapidDetails('mailto:'+(process.env.VAPID_EMAIL||'admin@example.com'),PUBLIC,PRIVATE);
const db=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}}):null;
let state={running:false,phase:'DETENIDO',cycles:0,found:0,bookings:0,lastOffer:null,settings:{min:110,max:500,stations:[],days:[1,2,3,4,5],from:'06:00',to:'22:00',testOffers:true,autoAccept:true,notifications:true,interval:5,device:'android',schedule:false},logs:[]},subscriptions=[];
const stamp=()=>new Date().toISOString();
function event(msg){state.logs.unshift({at:stamp(),msg});state.logs=state.logs.slice(0,100);}
async function init(){if(!db)return;await db.query('CREATE TABLE IF NOT EXISTS aa_data (id text PRIMARY KEY, value jsonb NOT NULL)');const r=await db.query("SELECT id,value FROM aa_data WHERE id IN ('state','subscriptions')");for(const row of r.rows){if(row.id==='state'){state={...state,...row.value,running:false,phase:'DETENIDO'};}else subscriptions=row.value;}await persist();}
async function persist(){if(!db)return;try{await db.query("INSERT INTO aa_data(id,value) VALUES('state',$1),('subscriptions',$2) ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value",[JSON.stringify(state),JSON.stringify(subscriptions)])}catch(e){console.error('Persist error',e.message)}}
function auth(req,res,next){const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');const a=Buffer.from(supplied),b=Buffer.from(TOKEN);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(401).json({error:'Clave de acceso incorrecta'});next()}
app.get('/api/config',auth,(req,res)=>res.json({vapidPublicKey:PUBLIC}));app.get('/api/status',auth,(req,res)=>res.json(state));
app.put('/api/settings',auth,async(req,res)=>{const s=req.body||{};const valid={...state.settings};if(Number.isFinite(+s.min))valid.min=Math.max(0,Math.min(10000,+s.min));if(Number.isFinite(+s.max))valid.max=Math.max(valid.min,Math.min(10000,+s.max));if(Array.isArray(s.stations))valid.stations=s.stations.filter(x=>typeof x==='string').slice(0,30);if(Array.isArray(s.days))valid.days=s.days.filter(x=>Number.isInteger(x)&&x>=0&&x<=6);for(const k of ['testOffers','autoAccept','notifications','schedule'])if(typeof s[k]==='boolean')valid[k]=s[k];if(['android','ios'].includes(s.device))valid.device=s.device;if(Number.isFinite(+s.interval))valid.interval=Math.max(2,Math.min(60,+s.interval));for(const k of ['from','to'])if(/^([01]\d|2[0-3]):[0-5]\d$/.test(s[k]))valid[k]=s[k];state.settings=valid;event('Configuración actualizada (sin iniciar motor)');await persist();res.json(state)});
app.post('/api/control',auth,async(req,res)=>{const action=req.body?.action;if(action==='stop'){state.running=false;state.phase='DETENIDO';event('■ Detención manual')}else if(action==='start'||action==='resume'){state.running=true;state.phase='BUSCANDO';event('▶ Inicio manual de simulación')}else return res.status(400).json({error:'Acción inválida'});await persist();res.json(state)});
app.post('/api/subscribe',auth,async(req,res)=>{const sub=req.body;if(!sub?.endpoint||!sub?.keys?.auth||!sub?.keys?.p256dh)return res.status(400).json({error:'Suscripción inválida'});subscriptions=subscriptions.filter(s=>s.endpoint!==sub.endpoint);subscriptions.push(sub);await persist();res.json({ok:true})});
async function push(title,body,{force=false}={}){
  const result={registered:subscriptions.length,sent:0,failed:0,expired:0,disabled:!state.settings.notifications};
  if(result.disabled&&!force)return result;
  await Promise.all([...subscriptions].map(async sub=>{
    try{
      await webpush.sendNotification(sub,JSON.stringify({title,body,url:'/'}),{TTL:120,urgency:'high'});
      result.sent++;
    }catch(e){
      result.failed++;
      if(e.statusCode===404||e.statusCode===410){result.expired++;subscriptions=subscriptions.filter(s=>s.endpoint!==sub.endpoint)}
      console.error('Push failed:',e.statusCode||'unknown',e.message);
    }
  }));
  await persist();
  return result;
}
app.get('/api/push-status',auth,(req,res)=>res.json({registered:subscriptions.length,notificationsEnabled:state.settings.notifications,persistentStorage:!!db}));
app.post('/api/push-test',auth,async(req,res)=>{
  const result=await push('Prueba de AsistenteAccesible','Esta es una notificación de prueba. No se realizó ninguna reserva.',{force:true});
  event(`Prueba push: ${result.sent} enviada(s), ${result.failed} fallida(s), ${result.registered} suscripción(es)`);
  await persist();
  res.json(result);
});
const stations=[['SMI1','Hazel Park'],['VMI1','Hazel Park'],['VET1','Livonia'],['VTW1','Wixom'],['DDT9','Canton'],['DDT6','Pontiac'],['DGR3','Sterling Heights'],['DDT3','Wixom'],['C043','Birmingham'],['C300','Detroit'],['C131','Ann Arbor'],['ZDT2','Ann Arbor'],['QMI2','Pontiac'],['RMI3','Waterford']];
let nextTick=0,busy=false;
setInterval(async()=>{if(!state.running||busy||!state.settings.testOffers||Date.now()<nextTick)return;busy=true;try{nextTick=Date.now()+state.settings.interval*1000;const s=state.settings;state.cycles++;const candidates=stations.filter(x=>!s.stations.length||s.stations.includes(x[0]));if(!candidates.length){event('Sin estaciones seleccionadas válidas');state.running=false;state.phase='DETENIDO';await persist();return}const station=candidates[Math.floor(Math.random()*candidates.length)];const price=Math.round((60+Math.random()*140)*100)/100;const offer={station:station[0],city:station[1],price,at:stamp(),simulated:true};state.lastOffer=offer;if(price>=s.min&&price<=s.max){state.found++;event(`Coincidencia SIMULADA: $${price} · ${station[0]}`);if(s.autoAccept){state.bookings++;state.running=false;state.phase='DETENIDO';event(`Reserva SIMULADA confirmada · $${price}. Motor DETENIDO; reinicio solo manual.`);{const result=await push('Reserva simulada confirmada',`$${price} · ${station[0]}. Motor detenido.`);event(`Push: ${result.sent} enviada(s), ${result.failed} fallida(s), ${result.registered} suscripción(es)`) }}else{{const result=await push('Coincidencia simulada',`$${price} · ${station[0]}. Sin aceptación automática.`);event(`Push: ${result.sent} enviada(s), ${result.failed} fallida(s), ${result.registered} suscripción(es)`) }}}await persist()}catch(e){console.error(e)}finally{busy=false}},500);
app.get('/health',(req,res)=>res.json({ok:true,mode:'SIMULACION',database:!!db}));
init().then(()=>app.listen(PORT,()=>console.log('AsistenteAccesible demo puerto',PORT))).catch(e=>{console.error(e);process.exit(1)});
