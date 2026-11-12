'use strict';
// Manage Amazon identities via official Login with Amazon; no credentials/tokens are stored.
// Amazon identity verification does NOT grant Amazon Flex offers or acceptance access.
const express=require('express');
const crypto=require('crypto');
const store=require('./amazon-account-store');
const {authorizationUrl,completeCode}=require('./amazon-oauth-core');
const sha256=v=>crypto.createHash('sha256').update(v).digest('hex');
const rand=(n=32)=>crypto.randomBytes(n).toString('base64url');
const CLIENT_ID=()=>process.env.LWA_CLIENT_ID||'';
const CLIENT_SECRET=()=>process.env.LWA_CLIENT_SECRET||'';
const REDIRECT_URI=()=>process.env.LWA_REDIRECT_URI||'';
const configured=()=>!!(CLIENT_ID()&&CLIENT_SECRET()&&/^https:\/\/[^/?#]+\/api\/amazon\/callback$/.test(REDIRECT_URI()));
const scope='profile'; // Amazon consent includes email, name and ID; NEVER Flex privileges.

function routes(db,currentUser){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
 async function auth(req,res,next){try{const u=await currentUser(db,req);if(!u)return res.status(401).json({error:'Primero inicia sesión en Detroit'});req.detroitUser=u;next()}catch(e){next(e)}}
 const respondError=(e,res,next)=>{
   const message={ALREADY_LINKED:'Esta identidad Amazon ya está vinculada a otro usuario de Detroit.',LIMIT_REACHED:'Límite de cinco identidades Amazon por usuario Detroit.',INVALID_ACCOUNT:'Identificador de cuenta inválido.',NOT_FOUND:'Cuenta no encontrada.'}[e.code];
   if(message)return res.status(e.code==='NOT_FOUND'?404:409).json({error:message});
   next(e);
 };
 router.get('/status',auth,async(req,res,next)=>{try{
   const accounts=await store.listAccounts(db,req.detroitUser.id);
   const active=accounts.find(x=>x.active)||null;
   res.json({configured:configured(),identityLinked:!!accounts.length,linkedAt:active?.linkedAt||null,
     scope,accounts,activeAccountId:active?.id||null,maxAccounts:store.MAX_ACCOUNTS,
     flexOffersAuthorized:false,flexAcceptanceAuthorized:false,
     description:accounts.length?'Identidades Amazon vinculadas. No autoriza acceso a ofertas Flex.':'Todavía no se ha vinculado ninguna identidad Amazon.'});
 }catch(e){next(e)}});
 router.get('/start',auth,async(req,res,next)=>{try{
   if(!configured())return res.status(503).send('Faltan parámetros LWA en Render.');
   const state=rand(),verifier=rand(48);
   await db.query('DELETE FROM aa_lwa_pending WHERE expires_at < NOW()');
   await db.query(`INSERT INTO aa_lwa_pending(state_hash,user_id,verifier,expires_at)
     VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')`,[sha256(state),req.detroitUser.id,verifier]);
   res.redirect(302,authorizationUrl({clientId:CLIENT_ID(),redirectUri:REDIRECT_URI(),state,verifier}));
 }catch(e){next(e)}});
 router.get('/callback',async(req,res,next)=>{try{
   const state=typeof req.query.state==='string'?req.query.state:'';
   if(!/^[a-zA-Z0-9_-]{40,120}$/.test(state))return res.status(400).send('Respuesta de autenticación inválida. Vuelve a Detroit.');
   const pending=await db.query('DELETE FROM aa_lwa_pending WHERE state_hash=$1 AND expires_at > NOW() RETURNING user_id,verifier',[sha256(state)]);
   if(!pending.rowCount)return res.status(400).send('Solicitud vencida o ya utilizada. Vuelve a Detroit.');
   if(req.query.error)return res.redirect(303,'/?amazon=denied');
   const code=typeof req.query.code==='string'?req.query.code:'';
   if(code.length<10||code.length>256)return res.redirect(303,'/?amazon=failed');
   let profile;
   try{profile=await completeCode({code,verifier:pending.rows[0].verifier,clientId:CLIENT_ID(),clientSecret:CLIENT_SECRET(),redirectUri:REDIRECT_URI()})}
   catch(e){console.error('LWA authorization failed:',e.message);return res.redirect(303,'/?amazon=failed')}
   try{await store.linkAccount(db,pending.rows[0].user_id,profile)}
   catch(e){if(e.code==='ALREADY_LINKED')return res.redirect(303,'/?amazon=already-linked');if(e.code==='LIMIT_REACHED')return res.redirect(303,'/?amazon=limit');throw e}
   res.redirect(303,'/?amazon=linked');
 }catch(e){next(e)}});
 router.post('/accounts/:id/activate',auth,async(req,res,next)=>{try{
   await store.activateAccount(db,req.detroitUser.id,req.params.id);res.json({ok:true});
 }catch(e){respondError(e,res,next)}});
 router.post('/accounts/:id/remove',auth,async(req,res,next)=>{try{
   await store.removeAccount(db,req.detroitUser.id,req.params.id);res.json({ok:true});
 }catch(e){respondError(e,res,next)}});
 // Preserve the previous endpoint; it now disconnects only the active identity.
 router.post('/disconnect',auth,async(req,res,next)=>{try{
   await store.removeActiveAccount(db,req.detroitUser.id);
   const accounts=await store.listAccounts(db,req.detroitUser.id);
   res.json({ok:true,identityLinked:accounts.length>0});
 }catch(e){next(e)}});
 return router;
}
module.exports={routes,init:store.init};
