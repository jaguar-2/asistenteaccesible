'use strict';
const express=require('express'),webpush=require('web-push'),{Pool}=require('pg'),crypto=require('crypto');
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'100kb'}));app.use(express.static('public'));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');if(!['GET','HEAD','OPTIONS'].includes(req.method)){const origin=req.get('origin');if(origin){try{if(new URL(origin).host!==req.get('host'))return res.status(403).json({error:'Origen no permitido'})}catch{return res.status(403).json({error:'Origen no válido'})}}}next()});
const PORT=process.env.PORT||3000, TOKEN=process.env.ADMIN_TOKEN||'', PUBLIC=process.env.VAPID_PUBLIC_KEY||'', PRIVATE=process.env.VAPID_PRIVATE_KEY||'';
if(!TOKEN||!PUBLIC||!PRIVATE){console.error('Faltan ADMIN_TOKEN, VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY');process.exit(1)}
webpush.setVapidDetails('mailto:'+(process.env.VAPID_EMAIL||'admin@example.com'),PUBLIC,PRIVATE);
const db=process.env.DATABASE_URL?new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL.includes('localhost')?false:{rejectUnauthorized:false}}):null;
const accountAuth=require('./account-auth');
const defaultSettings=()=>({min:110,max:500,stations:[],days:[1,2,3,4,5],from:'06:00',to:'22:00',testOffers:true,autoAccept:true,notifications:true,interval:5,device:'android',schedule:false});
const defaultState=()=>({running:false,phase:'DETENIDO',cycles:0,found:0,bookings:0,lastOffer:null,settings:defaultSettings(),logs:[]});
const userStates=new Map(),userSubscriptions=new Map();
const stamp=()=>new Date().toISOString();
async function init(){if(!db)throw Error('DATABASE_URL requerida para la versión 8');await accountAuth.init(db);await db.query('CREATE TABLE IF NOT EXISTS aa_data (id text PRIMARY KEY, value jsonb NOT NULL)');await db.query('CREATE TABLE IF NOT EXISTS aa_user_data(user_id BIGINT NOT NULL REFERENCES aa_users(id) ON DELETE CASCADE, kind TEXT NOT NULL, value JSONB NOT NULL, PRIMARY KEY(user_id,kind))');const legacy=await db.query("SELECT value FROM aa_data WHERE id='state'");const owner=await db.query('SELECT id FROM aa_users ORDER BY id ASC LIMIT 1');if(owner.rowCount&&legacy.rowCount){await db.query("INSERT INTO aa_user_data(user_id,kind,value) VALUES($1,'state',$2) ON CONFLICT DO NOTHING",[owner.rows[0].id,JSON.stringify({...legacy.rows[0].value,running:false,phase:'DETENIDO'})]);const oldSub=await db.query("SELECT value FROM aa_data WHERE id='subscriptions'");if(oldSub.rowCount)await db.query("INSERT INTO aa_user_data(user_id,kind,value) VALUES($1,'subscriptions',$2) ON CONFLICT DO NOTHING",[owner.rows[0].id,JSON.stringify(oldSub.rows[0].value)])}}
async function getUserState(id){if(userStates.has(String(id)))return userStates.get(String(id));const r=await db.query("SELECT kind,value FROM aa_user_data WHERE user_id=$1",[id]);let st=defaultState(),subs=[];for(const x of r.rows){if(x.kind==='state')st={...st,...x.value,running:false,phase:'DETENIDO',settings:{...defaultSettings(),...x.value.settings}};if(x.kind==='subscriptions')subs=x.value}userStates.set(String(id),st);userSubscriptions.set(String(id),subs);return st}
async function persistUser(id){await db.query("INSERT INTO aa_user_data(user_id,kind,value) VALUES($1,'state',$2),($1,'subscriptions',$3) ON CONFLICT(user_id,kind) DO UPDATE SET value=EXCLUDED.value",[id,JSON.stringify(userStates.get(String(id))),JSON.stringify(userSubscriptions.get(String(id))||[])])}
const accountRoutes=accountAuth.routes(db);app.use('/api/account',accountRoutes);
async function auth(req,res,next){try{const user=await accountAuth.currentUser(db,req);if(!user)return res.status(401).json({error:'Inicia sesión en Detroit'});req.detroitUser=user;req.userState=await getUserState(user.id);next()}catch(e){next(e)}}
app.get('/api/integration/status',auth,(req,res)=>res.json({provider:'Amazon Flex',connected:false,offersAvailable:false,acceptanceAvailable:false,reason:'No se ha identificado una API oficial autorizada. No se solicitan credenciales de Amazon.',simulationPreserved:true}));
app.get('/api/config',auth,(req,res)=>res.json({vapidPublicKey:PUBLIC}));app.get('/api/status',auth,(req,res)=>res.json(req.userState));
app.put('/api/settings',auth,async(req,res)=>{const s=req.body||{};const valid={...req.userState.settings};if(Number.isFinite(+s.min))valid.min=Math.max(0,Math.min(10000,+s.min));if(Number.isFinite(+s.max))valid.max=Math.max(valid.min,Math.min(10000,+s.max));if(Array.isArray(s.stations))valid.stations=s.stations.filter(x=>typeof x==='string').slice(0,30);if(Array.isArray(s.days))valid.days=s.days.filter(x=>Number.isInteger(x)&&x>=0&&x<=6);for(const k of ['testOffers','autoAccept','notifications','schedule'])if(typeof s[k]==='boolean')valid[k]=s[k];if(['android','ios'].includes(s.device))valid.device=s.device;if(Number.isFinite(+s.interval))valid.interval=Math.max(2,Math.min(60,+s.interval));for(const k of ['from','to'])if(/^([01]\d|2[0-3]):[0-5]\d$/.test(s[k]))valid[k]=s[k];req.userState.settings=valid;logUser(req.userState,'Configuración actualizada (sin iniciar motor)');await persistUser(req.detroitUser.id);res.json(req.userState)});
app.post('/api/control',auth,async(req,res)=>{const action=req.body?.action;if(action==='stop'){req.userState.running=false;req.userState.phase='DETENIDO';logUser(req.userState,'■ Detención manual')}else if(action==='start'||action==='resume'){req.userState.running=true;req.userState.phase='BUSCANDO';logUser(req.userState,'▶ Inicio manual de simulación')}else return res.status(400).json({error:'Acción inválida'});await persistUser(req.detroitUser.id);res.json(req.userState)});
app.post('/api/subscribe',auth,async(req,res)=>{const sub=req.body;if(!sub?.endpoint||!sub?.keys?.auth||!sub?.keys?.p256dh)return res.status(400).json({error:'Suscripción inválida'});let subscriptions=userSubscriptions.get(String(req.detroitUser.id))||[];subscriptions=subscriptions.filter(s=>s.endpoint!==sub.endpoint);subscriptions.push(sub);userSubscriptions.set(String(req.detroitUser.id),subscriptions);await persistUser(req.detroitUser.id);res.json({ok:true})});
async function push(userId,title,body,{force=false}={}){
  const state=await getUserState(userId);let subscriptions=userSubscriptions.get(String(userId))||[];
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
  userSubscriptions.set(String(userId),subscriptions);await persistUser(userId);
  return result;
}
app.get('/api/push-status',auth,(req,res)=>res.json({registered:(userSubscriptions.get(String(req.detroitUser.id))||[]).length,notificationsEnabled:req.userState.settings.notifications,persistentStorage:!!db}));
app.post('/api/push-test',auth,async(req,res)=>{
  const result=await push(req.detroitUser.id,'Prueba de AsistenteAccesible','Esta es una notificación de prueba. No se realizó ninguna reserva.',{force:true});
  logUser(req.userState,`Prueba push: ${result.sent} enviada(s), ${result.failed} fallida(s), ${result.registered} suscripción(es)`);
  await persistUser(req.detroitUser.id);
  res.json(result);
});
const stations=[['SMI1','Hazel Park'],['VMI1','Hazel Park'],['VET1','Livonia'],['VTW1','Wixom'],['DDT9','Canton'],['DDT6','Pontiac'],['DGR3','Sterling Heights'],['DDT3','Wixom'],['C043','Birmingham'],['C300','Detroit'],['C131','Ann Arbor'],['ZDT2','Ann Arbor'],['QMI2','Pontiac'],['RMI3','Waterford']];
const nextTicks=new Map(),busyUsers=new Set();
function logUser(st,msg){st.logs.unshift({at:stamp(),msg});st.logs=st.logs.slice(0,100)}
setInterval(async()=>{for(const [id,s] of userStates){if(!s.running||busyUsers.has(id)||!s.settings.testOffers||Date.now()<(nextTicks.get(id)||0))continue;busyUsers.add(id);try{nextTicks.set(id,Date.now()+s.settings.interval*1000);s.cycles++;const candidates=stations.filter(x=>!s.settings.stations.length||s.settings.stations.includes(x[0]));if(!candidates.length){logUser(s,'Sin estaciones válidas');s.running=false;s.phase='DETENIDO';await persistUser(id);continue}const station=candidates[Math.floor(Math.random()*candidates.length)],price=Math.round((60+Math.random()*140)*100)/100;s.lastOffer={station:station[0],city:station[1],price,at:stamp(),simulated:true};if(price>=s.settings.min&&price<=s.settings.max){s.found++;logUser(s,`Coincidencia SIMULADA: $${price} · ${station[0]}`);if(s.settings.autoAccept){s.bookings++;s.running=false;s.phase='DETENIDO';logUser(s,`Reserva SIMULADA confirmada · $${price}. Motor DETENIDO.`)}const result=await push(id,s.settings.autoAccept?'Reserva simulada confirmada':'Coincidencia simulada',`$${price} · ${station[0]}. ${s.settings.autoAccept?'Motor detenido.':'Sin aceptación automática.'}`);logUser(s,`Push: ${result.sent} enviada(s), ${result.failed} fallida(s)`)}await persistUser(id)}catch(e){console.error('User tick',id,e)}finally{busyUsers.delete(id)}}},500);
app.get('/health',(req,res)=>res.json({ok:true,mode:'SIMULACION',database:!!db,accountLogin:!!db,amazonIntegration:false}));
init().then(()=>app.listen(PORT,()=>console.log('AsistenteAccesible demo puerto',PORT))).catch(e=>{console.error(e);process.exit(1)});
