'use strict';
/**
 * Read-only decoder for historical Amazon Flex-shaped offer responses.
 * Evidence: RE-FLEX main.py get_offer_list/list_format, captured Nov 2026.
 * This module NEVER fetches Amazon, authenticates, signs, accepts offers, or
 * treats a user-supplied payload as Amazon-verified.
 */
const {normalizeOffer} = require('./offer-engine');
const MAX_OFFERS = 200;

function timestampToIso(seconds, field) {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 946684800 || seconds > 4102444800)
    throw new TypeError(`${field} debe contener segundos Unix (no milisegundos)`);
  return new Date(seconds * 1000).toISOString();
}

function decodeLegacyOffer(raw, stationByServiceAreaId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('Registro de oferta inválido');
  if (raw.hidden === true) throw new TypeError('Oferta oculta');
  const stationId=raw.serviceAreaId;
  if (typeof stationId !== 'string' || !stationId) throw new TypeError('Falta serviceAreaId');
  const station=stationByServiceAreaId[stationId];
  if (!station) throw new TypeError('Estación no identificada: falta mapeo autorizado de serviceAreaId');
  const input={
    id:raw.offerId,
    station,
    price:raw.rateInfo?.priceAmount,
    start:timestampToIso(raw.startTime,'startTime'),
    end:timestampToIso(raw.endTime,'endTime'),
    currency:'USD'
  };
  const offer=normalizeOffer(input);
  return Object.freeze({...offer,offerType:typeof raw.offerType==='string'?raw.offerType:null,
    provenance:'historical-schema-unverified',sourceVerified:false});
}

function decodeLegacyResponse(response,stationByServiceAreaId={}) {
  if (!response || typeof response !== 'object' || !Array.isArray(response.offerList))
    throw new TypeError('Respuesta inválida: falta offerList[]');
  if (response.offerList.length>MAX_OFFERS) throw new RangeError(`Demasiados registros; máximo ${MAX_OFFERS}`);
  if (!stationByServiceAreaId || typeof stationByServiceAreaId!=='object' || Array.isArray(stationByServiceAreaId))
    throw new TypeError('El mapeo de estaciones debe ser un objeto');
  const offers=[],skipped=[];
  for (const [index,raw] of response.offerList.entries()) {
    try { offers.push(decodeLegacyOffer(raw,stationByServiceAreaId)); }
    catch(e) { skipped.push({index,reason:e.message}); }
  }
  return {offers,skipped,sourceVerified:false,canBook:false,
    note:'Conversión de formato histórico. Los datos NO están autenticados como Amazon Flex.'};
}
module.exports={decodeLegacyOffer,decodeLegacyResponse,timestampToIso,MAX_OFFERS};
