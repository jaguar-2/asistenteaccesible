'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authorizationUrl,pkceChallenge,completeCode}=require('./amazon-oauth-core');
const params={clientId:'id-test',redirectUri:'https://asistenteaccesible-detroit.onrender.com/api/amazon/callback',state:'a'.repeat(43),verifier:'x'.repeat(64)};
test('authorize uses Amazon HTTPS URL',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.hostname,'www.amazon.com');assert.equal(u.protocol,'https:')});
test('authorization code flow',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.searchParams.get('response_type'),'code')});
test('profile scope requests name and email consent',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.searchParams.get('scope'),'profile')});
test('PKCE S256',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('code_challenge'),pkceChallenge(params.verifier))});
test('anti-CSRF state stays intact',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.searchParams.get('state'),params.state)});
test('registered return URL fixed',()=>{const u=new URL(authorizationUrl(params));assert.equal(u.searchParams.get('redirect_uri'),params.redirectUri)});
test('no client secret exposed in authorize URL',()=>{assert.equal(authorizationUrl(params).includes('secret'),false)});
test('no phone/email/amazon password in authorize URL',()=>{assert.equal(/password|phone|email=/.test(authorizationUrl(params)),false)});
test('test mocked token and profile response',async()=>{
 const calls=[];const fn=async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>url.includes('/token')?{access_token:'test-token',token_type:'bearer'}:{user_id:'amzn1.account.sample',email:'person@example.com',name:'Persona de prueba'}}};
 const r=await completeCode({code:'valid-example-code',verifier:params.verifier,clientId:'id-test',clientSecret:'server-only',redirectUri:params.redirectUri,fetchFn:fn});
 assert.equal(r.userId,'amzn1.account.sample');assert.equal(r.email,'person@example.com');assert.equal(r.name,'Persona de prueba');assert.equal(calls.length,2);assert.equal(calls[0].opts.body.get('grant_type'),'authorization_code');assert.equal(calls[0].opts.body.get('client_secret'),'server-only');assert.equal(calls[1].opts.headers.Authorization,'Bearer test-token');
});
test('reject token failure without making profile call',async()=>{
 let calls=0;await assert.rejects(completeCode({code:'valid-example-code',verifier:params.verifier,clientId:'id',clientSecret:'secret',redirectUri:params.redirectUri,fetchFn:async()=>{calls++;return{ok:false}}}));assert.equal(calls,1);
});
test('reject malformed token',async()=>{await assert.rejects(completeCode({code:'valid-example-code',verifier:params.verifier,clientId:'id',clientSecret:'secret',redirectUri:params.redirectUri,fetchFn:async()=>({ok:true,json:async()=>({wrong:'x'})})}))});
test('reject invalid profile identity',async()=>{let i=0;await assert.rejects(completeCode({code:'valid-example-code',verifier:params.verifier,clientId:'id',clientSecret:'secret',redirectUri:params.redirectUri,fetchFn:async()=>({ok:true,json:async()=>++i===1?{access_token:'x'}:{user_id:'bad-id'}})}))});

test('profile identity only can be returned without email',async()=>{
 let n=0;const response=async()=>({ok:true,json:async()=>++n===1?{access_token:'x'}:{user_id:'amzn1.account.legacy'}});
 const r=await completeCode({code:'valid-example-code',verifier:params.verifier,clientId:'id',clientSecret:'secret',redirectUri:params.redirectUri,fetchFn:response});
 assert.equal(r.email,null);assert.equal(r.name,null);
});
