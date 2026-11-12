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

const {buildReadQuery,classifyPostStatus,probeReadOnlyPost}=require('./flex-api-probe');

test('POST de diagnóstico usa ruta fija y solo cuerpo de consulta, sin secretos',async()=>{
 const requests=[];
 const fake=async(url,options)=>{requests.push({url,options});return {status:403,headers:{get:()=>null},body:{cancel:async()=>{}}}};
 const result=await probeReadOnlyPost({request:fake,now:Date.UTC(2026,10,12),timeoutMs:1500});
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://flex-capacity-na.amazon.com/GetOffersForProviderPost');
 assert.equal(requests[0].options.method,'POST');
 assert.equal(requests[0].options.credentials,'omit');
 assert.equal(requests[0].options.redirect,'manual');
 assert.deepEqual(Object.keys(requests[0].options.headers).sort(),['accept','content-type']);
 assert.equal(requests[0].options.headers.authorization,undefined);
 const payload=JSON.parse(requests[0].options.body);
 assert.deepEqual(payload.serviceAreaIds,[]);
 assert.deepEqual(payload.filters.serviceAreaFilter,[]);
 assert.equal(result.classification,'AUTORIZACION_DENEGADA');
 assert.equal(result.realOffersVerified,false);
 assert.equal(result.acceptanceAttempted,false);
});

test('clasifica respuestas sin falsos positivos de ofertas auténticas',async()=>{
 assert.equal(classifyPostStatus(420),'BLOQUEO_ESPECIFICO_FLEX');
 assert.equal(classifyPostStatus(405),'METODO_POST_NO_ADMITIDO');
 assert.equal(classifyPostStatus(429),'LIMITE_DE_SOLICITUDES');
 const res=await probeReadOnlyPost({request:async()=>({status:200,headers:{get:()=>null}})});
 assert.equal(res.httpStatus,200);
 assert.equal(res.realOffersVerified,false);
});

test('fallo de red no provoca reintentos ni fuga de detalles',async()=>{
 let attempts=0;
 const res=await probeReadOnlyPost({request:async()=>{attempts++;throw Error('secret_token_sensitive')}});
 assert.equal(attempts,1);
 assert.equal(res.classification,'ERROR_DE_RED');
 assert.equal(JSON.stringify(res).includes('secret_token_sensitive'),false);
});

test('el esquema histórico de consulta no incluye identidad ni aceptación',()=>{
 const payload=buildReadQuery(Date.UTC(2026,10,12));
 assert.equal(payload.apiVersion,'V2');
 assert.equal(payload.filters.timeFilter.endTime-payload.filters.timeFilter.startTime,86400);
 assert.equal(JSON.stringify(payload).includes('AcceptOffer'),false);
});
