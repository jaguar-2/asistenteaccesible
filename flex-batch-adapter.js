'use strict';
/**
 * Detroit's read-only ingestion boundary for two EXPLICIT contracts.
 * 1. legacy-offer-list: historically observed offerList[] (RE-FLEX).
 * 2. detroit-group-v1: OUR bridge format, NOT a claimed GetOfferGroups API schema.
 * Both are untrusted events until a real authorized upstream is verified.
 * No network requests, authentication to Amazon, offer acceptance, or raw credential storage.
 */
const {normalizeOffer} = require('./offer-engine');
const {decodeLegacyResponse} = require('./flex-legacy-adapter');
const MAX_OFFERS = 60, MAX_GROUPS = 12, MAX_STATIONS = 100;
const FORMATS = Object.freeze(['legacy-offer-list','detroit-group-v1']);
const SOURCES = Object.freeze({
  'legacy-offer-list':'external-legacy-unverified',
  'detroit-group-v1':'external-group-unverified'
});
class PayloadError extends Error {
  constructor(message){super(message);this.name='PayloadError';this.code='INVALID_PAYLOAD'}
}
function isObject(v){return !!v && typeof v==='object' && !Array.isArray(v)}
function stationMapFrom(input){
  if(input===undefined)return Object.create(null);
  if(!isObject(input))throw new PayloadError('stationMap debe ser un objeto');
  const map=Object.create(null),entries=Object.entries(input);
  if(entries.length>MAX_STATIONS)throw new PayloadError('Límite de 100 estaciones por lote');
  for(const [id,station] of entries){
    if(!/^[A-Za-z0-9-]{2,90}$/.test(id) || typeof station!=='string' || !/^[A-Za-z0-9-]{2,20}$/.test(station))
      throw new PayloadError('Identificador o código de estación inválido');
    map[id]=station.toUpperCase();
  }
  return map;
}
function parseLegacy(payload,stationMap){
  if(!isObject(payload) || !Array.isArray(payload.offerList))
    throw new PayloadError('Se requiere payload.offerList[]');
  if(payload.offerList.length>MAX_OFFERS)
    throw new PayloadError('Máximo 60 ofertas por lote');
  const converted=decodeLegacyResponse(payload,stationMap);
  return {offers:converted.offers.map(offer=>({...offer,model:'legacy-offer-list'})),
    skipped:converted.skipped,totalRecords:payload.offerList.length,source:SOURCES['legacy-offer-list'],
    schema:'formato histórico documentado; NO verificado en sesión real'};
}
function parseGroups(payload){
  if(!isObject(payload) || !Array.isArray(payload.groups))
    throw new PayloadError('Se requiere payload.groups[] del contrato Detroit');
  if(payload.groups.length>MAX_GROUPS)throw new PayloadError('Máximo 12 grupos por lote');
  const offers=[],skipped=[];
  let totalRecords=0;
  for(const [groupIndex,group] of payload.groups.entries()){
    if(!isObject(group))throw new PayloadError('Grupo inválido');
    if(typeof group.groupId!=='string'||!/^[A-Za-z0-9._:-]{1,90}$/.test(group.groupId))
      throw new PayloadError('groupId inválido');
    // A group count/summary is never fabricated into individual bookable offers.
    if(group.offers===undefined || group.offers===null){
      skipped.push({groupId:group.groupId,reason:'Solo metadatos del grupo: faltan ofertas individuales'});
      continue;
    }
    if(!Array.isArray(group.offers))throw new PayloadError('group.offers debe ser un arreglo');
    totalRecords+=group.offers.length;
    if(totalRecords>MAX_OFFERS)throw new PayloadError('Máximo 60 ofertas individuales por lote');
    for(const [index,raw] of group.offers.entries()){
      try{
        if(!isObject(raw))throw new TypeError('Oferta inválida');
        if(raw.hidden===true)throw new TypeError('Oferta marcada como oculta');
        // This is already-normalized data supplied by a connector, not native GetOfferGroups output.
        const offer=normalizeOffer(raw);
        offers.push({...offer,groupId:group.groupId,model:'detroit-group-v1',
          sourceVerified:false,provenance:'detroit-bridge-unverified'});
      }catch(e){skipped.push({groupId:group.groupId,index,reason:e.message})}
    }
  }
  return {offers,skipped,totalRecords,groupCount:payload.groups.length,
    source:SOURCES['detroit-group-v1'],
    schema:'contrato de adaptador Detroit; NO es el formato nativo GetOfferGroups'};
}
function decodeBatch(request){
  if(!isObject(request))throw new PayloadError('Se requiere un objeto de lote');
  const {format,payload}=request;
  if(!FORMATS.includes(format))throw new PayloadError('Formato no soportado');
  const stationMap=stationMapFrom(request.stationMap);
  const decoded=format==='legacy-offer-list'?parseLegacy(payload,stationMap):parseGroups(payload);
  return Object.freeze({format,...decoded,verifiedAmazonSource:false,bookable:false});
}
module.exports={decodeBatch,PayloadError,FORMATS,SOURCES,MAX_OFFERS,MAX_GROUPS};
