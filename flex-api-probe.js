'use strict';
/*
 * Detroit — network capability research only.
 * HEAD diagnostics and a separately triggered, single read-only-query POST.
 * No credentials, cookies, device identity, signatures, retries, or bookings.
 * HTTP responses do NOT prove authorized offers access.
 */
const TARGETS = Object.freeze([
  Object.freeze({
    id: 'flex-legacy-offers',
    label: 'Ruta histórica Flex: GetOffersForProviderPost',
    url: 'https://flex-capacity-na.amazon.com/GetOffersForProviderPost',
    kind: 'private-historical',
    details: 'Registrada en RE-FLEX; requiere autenticación específica y posiblemente firmas de dispositivo.'
  }),
  Object.freeze({
    id: 'flex-legacy-service-areas',
    label: 'Ruta histórica Flex: GetServiceAreas',
    url: 'https://flex-capacity-na.amazon.com/GetServiceAreas',
    kind: 'private-historical',
    details: 'Ruta de consulta de zonas encontrada en implementaciones antiguas.'
  }),
  Object.freeze({
    id: 'amazon-lwa-profile',
    label: 'Login with Amazon: perfil',
    url: 'https://api.amazon.com/user/profile',
    kind: 'identity-not-offers',
    details: 'API de identidad. No permite consultar bloques de Amazon Flex.'
  }),
  Object.freeze({
    id: 'amazon-spapi-getoffers',
    label: 'Selling Partner API: getOffers',
    url: 'https://sellingpartnerapi-na.amazon.com/fulfillment/outbound/2026-07-04/offers',
    kind: 'other-product-not-flex',
    details: 'Ofertas de entrega de productos para vendedores: NO son bloques de repartidores Flex.'
  })
]);

async function probeOne(target, request = globalThis.fetch, timeoutMs = 6500) {
  const started=Date.now();
  try {
    const response=await request(target.url, {
      method:'HEAD',
      redirect:'manual',
      credentials:'omit',
      cache:'no-store',
      signal:AbortSignal.timeout(timeoutMs)
    });
    return {
      id:target.id,label:target.label,kind:target.kind,
      reachableByHead:true,httpStatus:response.status,
      elapsedMs:Date.now()-started,
      finding:'El servidor respondió a HEAD. No se ha autenticado ni consultado ninguna oferta.',
      flexOffersAccessVerified:false
    };
  } catch(error) {
    const code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    return {
      id:target.id,label:target.label,kind:target.kind,
      reachableByHead:false,httpStatus:null,
      elapsedMs:Date.now()-started,errorType:code,
      finding:'No se pudo comprobar la ruta desde este servidor; no significa que la API haya dejado de existir.',
      flexOffersAccessVerified:false
    };
  }
}

async function probeAll({request=globalThis.fetch,timeoutMs=6500}={}) {
  const results=[];
  // Sequential, one request per endpoint. No retries and no traffic bursts.
  for (const t of TARGETS) results.push(await probeOne(t,request,timeoutMs));
  return {
    testedAt:new Date().toISOString(),mode:'unauthenticated-head-only',
    liveOffersConnected:false,credentialsUsed:false,offersRequested:false,
    conclusion:'Prueba de conectividad HTTP. No confirma permisos para consultar ofertas reales.',
    results
  };
}

// Protocol experiment, only on explicit user action. The historical POST endpoint
// is a READ query, NOT /AcceptOffer. No account/region identifiers or tokens.
const READ_QUERY_URL='https://flex-capacity-na.amazon.com/GetOffersForProviderPost';
function classifyPostStatus(status){
  if (status===200) return 'HTTP_OK_SIN_VALIDAR_OFERTAS';
  if (status===400 || status===422) return 'SOLICITUD_RECHAZADA_O_ESQUEMA_INCOMPATIBLE';
  if (status===401 || status===403) return 'AUTORIZACION_DENEGADA';
  if (status===404) return 'RUTA_NO_ENCONTRADA_O_NO_EXPUESTA';
  if (status===405) return 'METODO_POST_NO_ADMITIDO';
  if (status===420) return 'BLOQUEO_ESPECIFICO_FLEX';
  if (status===429) return 'LIMITE_DE_SOLICITUDES';
  if (status>=500) return 'ERROR_SERVIDOR';
  return 'RESPUESTA_NO_CONCLUYENTE';
}
function buildReadQuery(now=Date.now()){
  const startTime=Math.floor(now/1000);
  return {
    apiVersion:'V2',
    filters:{serviceAreaFilter:[],timeFilter:{startTime,endTime:startTime+86400}},
    serviceAreaIds:[]
  };
}
async function probeReadOnlyPost({request=globalThis.fetch,timeoutMs=7000,now=Date.now()}={}) {
  const started=Date.now();
  try {
    const response=await request(READ_QUERY_URL,{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json'},
      body:JSON.stringify(buildReadQuery(now)),
      redirect:'manual',credentials:'omit',cache:'no-store',
      signal:AbortSignal.timeout(timeoutMs)
    });
    // Do not read a successful body: it could contain private driver/offers data.
    // The endpoint is unauthenticated; an HTTP 200 alone is NOT verified access.
    try {await response.body?.cancel?.()}catch {}
    const status=response.status;
    const headers=response.headers;
    return {
      testedAt:new Date().toISOString(),endpoint:'GetOffersForProviderPost',
      method:'POST',httpStatus:status,classification:classifyPostStatus(status),
      elapsedMs:Date.now()-started,
      contentType:headers?.get?.('content-type')||null,
      credentialsUsed:false,deviceSignatureUsed:false,
      realOffersVerified:false,acceptanceAttempted:false,
      message:status===200
        ? 'El endpoint devolvió HTTP 200 sin credenciales. NO se validó el contenido ni el origen de ofertas.'
        : 'Respuesta a POST de consulta sin credenciales. No demuestra acceso a ofertas.'
    };
  }catch(error){
    return {
      testedAt:new Date().toISOString(),endpoint:'GetOffersForProviderPost',
      method:'POST',httpStatus:null,
      classification:(error?.name==='TimeoutError'||error?.name==='AbortError')?'TIMEOUT':'ERROR_DE_RED',
      elapsedMs:Date.now()-started,credentialsUsed:false,deviceSignatureUsed:false,
      realOffersVerified:false,acceptanceAttempted:false,
      message:'No se pudo completar la prueba desde Render. No confirma el estado del endpoint.'
    };
  }
}
module.exports={TARGETS,probeOne,probeAll,buildReadQuery,classifyPostStatus,probeReadOnlyPost};
if(require.main===module)probeAll().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Error de diagnóstico:',e.message);process.exitCode=1});
