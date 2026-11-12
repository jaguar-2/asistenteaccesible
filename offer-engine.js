'use strict';

// Source-neutral engine. It NEVER connects to Amazon Flex, impersonates devices,
// signs private API requests or claims that a block was booked.
const crypto = require('node:crypto');
const DEFAULT_ZONE = 'America/Detroit';

class OfferError extends Error {
  constructor(message, code='INVALID_OFFER') { super(message); this.name='OfferError'; this.code=code; }
}
function asIsoDate(value, name) {
  const d = new Date(value);
  if(typeof value !== 'string' || !Number.isFinite(d.getTime()) || !/\d{4}-\d\d-\d\dT/.test(value)) throw new OfferError(`${name} debe ser fecha ISO 8601`);
  return d.toISOString();
}
function normalizeOffer(input) {
  if(!input || typeof input!=='object' || Array.isArray(input)) throw new OfferError('Oferta inválida');
  const id = input.id, station = input.station, price = input.price;
  if(typeof id !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(id)) throw new OfferError('ID de oferta inválido');
  if(typeof station !== 'string' || !/^[A-Za-z0-9-]{2,20}$/.test(station)) throw new OfferError('Estación inválida');
  if(typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 10000) throw new OfferError('Precio inválido');
  const start = asIsoDate(input.start, 'start');
  const end = asIsoDate(input.end, 'end');
  const hours=(Date.parse(end)-Date.parse(start))/3600000;
  if(!(hours>0 && hours<=24)) throw new OfferError('Duración inválida');
  if(input.currency !== undefined && input.currency !== 'USD') throw new OfferError('Moneda no compatible');
  return Object.freeze({id, station:station.toUpperCase(),price:Math.round(price*100)/100,currency:'USD',start,end,durationHours:hours});
}
function localParts(iso,timeZone=DEFAULT_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const x=Object.fromEntries(fmt.formatToParts(new Date(iso)).map(p=>[p.type,p.value]));
  const days={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {day:days[x.weekday],minute:Number(x.hour)*60+Number(x.minute)};
}
function minutes(s) {return typeof s==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? 60*Number(s.slice(0,2))+Number(s.slice(3)) : null}
function evaluateOffer(offer,settings={},timeZone=DEFAULT_ZONE){
  const o=normalizeOffer(offer);
  const reasons=[];
  if(Number.isFinite(settings.min) && o.price<settings.min) reasons.push('Precio inferior al mínimo');
  if(Number.isFinite(settings.max) && o.price>settings.max) reasons.push('Precio superior al máximo');
  if(Array.isArray(settings.stations) && settings.stations.length && !settings.stations.map(x=>String(x).toUpperCase()).includes(o.station)) reasons.push('Estación desactivada');
  const {day,minute}=localParts(o.start,timeZone);
  if(Array.isArray(settings.days) && !settings.days.includes(day)) reasons.push('Día desactivado');
  const from=minutes(settings.from),to=minutes(settings.to);
  if(from!==null && to!==null) {
    const within=from===to || (from<to ? minute>=from&&minute<=to : minute>=from||minute<=to);
    if(!within) reasons.push('Fuera del horario');
  }
  return {match:reasons.length===0,reasons};
}
// Classify provider failures without hiding activity or defeating provider controls.
function classifyProviderError(status,retryAfterSeconds=0) {
  if(status===401)return {code:'LOGIN_REQUIRED',retry:false,message:'La sesión debe renovarse con el método autorizado del proveedor.'};
  if(status===403)return {code:'ACCESS_DENIED',retry:false,message:'Acceso denegado por el proveedor. Detener conexión.'};
  if(status===429)return {code:'RATE_LIMITED',retry:false,retryAfterSeconds:Math.max(0,Math.min(86400,Number(retryAfterSeconds)||0)),message:'Límite del proveedor. Suspender solicitudes y respetar Retry-After.'};
  if(status>=500&&status<600)return {code:'SERVICE_UNAVAILABLE',retry:true,message:'Fallo temporal: usar reintentos limitados con espera exponencial.'};
  return {code:'PROVIDER_ERROR',retry:false,message:'Fallo del proveedor; no asumir reserva confirmada.'};
}
function newIngestKey(){return 'dti_'+crypto.randomBytes(32).toString('base64url')}
function keyHash(key){return crypto.createHash('sha256').update(key).digest('hex')}
function validateIngestKey(key){return typeof key==='string'&&/^dti_[A-Za-z0-9_-]{43}$/.test(key)}
// This adapter boundary is explicit. No live acceptance until a provider is implemented.
async function acceptWithProvider({provider,offer}){
  if(!provider || typeof provider.acceptOffer!=='function') {
    const err=new Error('No hay proveedor autorizado con capacidad de aceptación. No se reservó ningún bloque.');err.code='ACCEPT_UNAVAILABLE';throw err;
  }
  const response=await provider.acceptOffer(offer);
  if(response?.confirmed!==true || typeof response?.confirmationId!=='string' || !response.confirmationId) {
    const err=new Error('El proveedor no confirmó la reserva.');err.code='NOT_CONFIRMED';throw err;
  }
  return {confirmed:true,confirmationId:response.confirmationId};
}
module.exports={OfferError,normalizeOffer,evaluateOffer,newIngestKey,keyHash,validateIngestKey,acceptWithProvider,classifyProviderError};
