'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {TARGETS,probeAll,probeOne}=require('./flex-api-probe');

test('rutas están documentadas y ninguna es una fuente Flex oficial confirmada',()=>{
 assert.equal(TARGETS.length,4);
 assert.equal(TARGETS.filter(x=>x.kind==='private-historical').length,2);
 assert.equal(TARGETS.some(x=>x.kind==='official-flex-offers'),false);
});

test('sin secretos: usa HEAD, sin cookies, tokens ni métodos con mutaciones',async()=>{
 const requests=[];
 const fake=async(url,init)=>{requests.push({url,init});return {status:405}};
 const result=await probeAll({request:fake});
 assert.equal(requests.length,4);
 for(const x of requests){
   assert.equal(x.init.method,'HEAD');
   assert.equal(x.init.credentials,'omit');
   assert.equal(x.init.redirect,'manual');
   assert.equal(x.init.body,undefined);
   assert.equal(x.init.headers,undefined);
 }
 assert.equal(result.credentialsUsed,false);
 assert.equal(result.offersRequested,false);
 assert.equal(result.liveOffersConnected,false);
 assert.equal(result.results.every(x=>x.flexOffersAccessVerified===false),true);
 assert.equal(result.results.every(x=>x.httpStatus===405),true);
});

test('una falla de red se registra y la investigación continúa',async()=>{
 let n=0;
 const fake=async()=>{n++;if(n===1)throw Error('Network failed');return {status:403}};
 const result=await probeAll({request:fake});
 assert.equal(result.results[0].errorType,'NETWORK_ERROR');
 assert.equal(result.results[0].reachableByHead,false);
 assert.equal(result.results[1].httpStatus,403);
 assert.equal(result.results.length,4);
});

test('un HTTP 200 nunca marca ofertas verificadas',async()=>{
 const r=await probeOne(TARGETS[0],async()=>({status:200}));
 assert.equal(r.reachableByHead,true);
 assert.equal(r.flexOffersAccessVerified,false);
});
