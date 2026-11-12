'use strict';
const crypto=require('crypto');
const base64url = value => Buffer.from(value).toString('base64url');
const pkceChallenge = verifier => base64url(crypto.createHash('sha256').update(verifier).digest());
const scope = 'profile';
function authorizationUrl({clientId,redirectUri,state,verifier}) {
  const u = new URL('https://www.amazon.com/ap/oa');
  for(const [k,v] of Object.entries({client_id:clientId,scope,response_type:'code',redirect_uri:redirectUri,state,code_challenge:pkceChallenge(verifier),code_challenge_method:'S256'}))u.searchParams.set(k,v);
  return u.toString();
}
async function completeCode({code,verifier,clientId,clientSecret,redirectUri,fetchFn=fetch}){
  const payload = new URLSearchParams({grant_type:'authorization_code',code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,code_verifier:verifier});
  const response = await fetchFn('https://api.amazon.com/auth/o2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:payload,signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Amazon rechazó el código de autorización');
  const t=await response.json();
  if(typeof t.access_token!=='string'||!t.access_token||!['bearer','Bearer'].includes(t.token_type||'bearer'))throw new Error('Amazon no entregó un token válido');
  const p=await fetchFn('https://api.amazon.com/user/profile',{headers:{Authorization:`Bearer ${t.access_token}`},signal:AbortSignal.timeout(12000)});
  if(!p.ok)throw new Error('Amazon no autorizó la lectura del identificador');
  const profile=await p.json();
  if(typeof profile.user_id!=='string'||!/^amzn1\./.test(profile.user_id)||profile.user_id.length>255)throw new Error('Amazon no entregó un identificador válido');
  // t.access_token and refresh_token remain only as short-lived local variables, never persisted.
  const email=typeof profile.email==='string'&&profile.email.length<=320?profile.email:null;
  const name=typeof profile.name==='string'&&profile.name.length<=160?profile.name:null;
  return {userId:profile.user_id,email,name};
}
module.exports={authorizationUrl,completeCode,pkceChallenge};
