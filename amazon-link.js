'use strict';
// Link an Amazon identity to an existing Detroit account via documented Login with Amazon OAuth.
// This module deliberately does not store Amazon credentials/tokens or claim Amazon Flex API access.
const express = require('express');
const crypto = require('crypto');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const {authorizationUrl,completeCode}=require('./amazon-oauth-core');
const rand = (n=32) => crypto.randomBytes(n).toString('base64url');
const CLIENT_ID = () => process.env.LWA_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.LWA_CLIENT_SECRET || '';
const REDIRECT_URI = () => process.env.LWA_REDIRECT_URI || '';
const configured = () => !!(CLIENT_ID() && CLIENT_SECRET() && /^https:\/\/[^/?#]+\/api\/amazon\/callback$/.test(REDIRECT_URI()));
const scope = 'profile:user_id';
async function init(db){
  await db.query(`CREATE TABLE IF NOT EXISTS aa_lwa_pending (
    state_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES aa_users(id) ON DELETE CASCADE,
    verifier TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  await db.query(`CREATE TABLE IF NOT EXISTS aa_lwa_links (
    user_id BIGINT PRIMARY KEY REFERENCES aa_users(id) ON DELETE CASCADE,
    amazon_user_id TEXT NOT NULL UNIQUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
}
function routes(db,currentUser){
 const router=express.Router();
 router.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');next()});
 async function auth(req,res,next){try{const u=await currentUser(db,req);if(!u)return res.status(401).json({error:'Primero inicia sesión en Detroit'});req.detroitUser=u;next()}catch(e){next(e)}}
 router.get('/status',auth,async(req,res,next)=>{try{
   const r=await db.query('SELECT linked_at FROM aa_lwa_links WHERE user_id=$1',[req.detroitUser.id]);
   res.json({configured:configured(),identityLinked:!!r.rowCount,linkedAt:r.rows[0]?.linked_at||null,scope,flexOffersAuthorized:false,flexAcceptanceAuthorized:false,description:r.rowCount?'Identidad de Amazon verificada. NO concede permisos sobre ofertas de Flex.':'Todavía no se ha verificado la identidad Amazon con LWA.'});
 }catch(e){next(e)}});
 router.get('/start',auth,async(req,res,next)=>{try{
   if(!configured())return res.status(503).send('Conexión aún sin configurar: falta LWA_CLIENT_ID, LWA_CLIENT_SECRET o LWA_REDIRECT_URI en Render.');
   const state=rand(),verifier=rand(48);
   await db.query('DELETE FROM aa_lwa_pending WHERE expires_at < NOW()');
   await db.query(`INSERT INTO aa_lwa_pending(state_hash,user_id,verifier,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')`,[sha256(state),req.detroitUser.id,verifier]);
   return res.redirect(302,authorizationUrl({clientId:CLIENT_ID(),redirectUri:REDIRECT_URI(),state,verifier}));
 }catch(e){next(e)}});
 router.get('/callback',async(req,res,next)=>{try{
   const state=typeof req.query.state==='string'?req.query.state:'';
   if(!/^[a-zA-Z0-9_-]{40,120}$/.test(state))return res.status(400).send('Respuesta de autenticación inválida. Vuelve a Detroit.');
   const pending=await db.query('DELETE FROM aa_lwa_pending WHERE state_hash=$1 AND expires_at > NOW() RETURNING user_id,verifier',[sha256(state)]);
   if(!pending.rowCount)return res.status(400).send('Solicitud vencida o ya utilizada. Vuelve a Detroit.');
   if(req.query.error)return res.redirect(303,'/?amazon=denied');
   const code=typeof req.query.code==='string'?req.query.code:'';
   if(code.length<10||code.length>256)return res.redirect(303,'/?amazon=failed');
   let result;
   try{result=await completeCode({code,verifier:pending.rows[0].verifier,clientId:CLIENT_ID(),clientSecret:CLIENT_SECRET(),redirectUri:REDIRECT_URI()});}
   catch(e){console.error('LWA authorization failed:',e.message);return res.redirect(303,'/?amazon=failed')}
   try{await db.query(`INSERT INTO aa_lwa_links(user_id,amazon_user_id,linked_at) VALUES($1,$2,now()) ON CONFLICT(user_id) DO UPDATE SET amazon_user_id=EXCLUDED.amazon_user_id,linked_at=now()`,[pending.rows[0].user_id,result.userId]);}
   catch(e){if(e.code==='23505')return res.redirect(303,'/?amazon=already-linked');throw e}
   res.redirect(303,'/?amazon=linked');
 }catch(e){next(e)}});
 router.post('/disconnect',auth,async(req,res,next)=>{try{await db.query('DELETE FROM aa_lwa_links WHERE user_id=$1',[req.detroitUser.id]);res.json({ok:true,identityLinked:false})}catch(e){next(e)}});
 return router;
}
module.exports={routes,init};
