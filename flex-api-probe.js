'use strict';
/*
 * Detroit — network capability research only.
 * One HEAD request per historical/documented URL, without credentials, cookies,
 * device identity, tokens, payloads, retries, or automated offer searches.
 * An HTTP response proves ONLY that a route responded to HEAD; it cannot prove
 * authorized Amazon Flex access. No offering/booking endpoints are POSTed.
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

module.exports={TARGETS,probeOne,probeAll};
if(require.main===module)probeAll().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Error de diagnóstico:',e.message);process.exitCode=1});
