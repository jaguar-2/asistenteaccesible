'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decodeLegacyResponse,decodeLegacyOffer}=require('./flex-legacy-adapter');
const stationId='d7d8229a-9b4b-4b59-8ed1-dff3408ba25b';
const start=Math.floor(Date.parse('2026-11-15T13:00:00Z')/1000);
const block={offerId:'sample-001',serviceAreaId:stationId,startTime:start,endTime:start+10800,
 rateInfo:{priceAmount:120},hidden:false,offerType:'EXCLUSIVE'};
test('Convierte la estructura histórica a la estructura real de filtros Detroit',()=>{
 const result=decodeLegacyResponse({offerList:[block]}, {[stationId]:'DDT1'});
 assert.equal(result.offers.length,1);
 assert.equal(result.offers[0].station,'DDT1');
 assert.equal(result.offers[0].price,120);
 assert.equal(result.offers[0].durationHours,3);
 assert.equal(result.offers[0].offerType,'EXCLUSIVE');
 assert.equal(result.sourceVerified,false);
 assert.equal(result.canBook,false);
});
test('Nunca convierte ofertas ocultas en disponibles',()=>{
 const r=decodeLegacyResponse({offerList:[{...block,hidden:true}]},{[stationId]:'DDT1'});
 assert.equal(r.offers.length,0);assert.equal(r.skipped.length,1);
});
test('No adivina estaciones: exige correspondencia serviceAreaId',()=>{
 const r=decodeLegacyResponse({offerList:[block]},{});
 assert.equal(r.offers.length,0);assert.match(r.skipped[0].reason,/mapeo/i);
});
test('Rechaza timestamps en milisegundos y precios no numéricos',()=>{
 assert.throws(()=>decodeLegacyOffer({...block,startTime:start*1000},{[stationId]:'DDT1'}),/segundos/);
 const r=decodeLegacyResponse({offerList:[{...block,rateInfo:{priceAmount:'120'}}]},{[stationId]:'DDT1'});
 assert.equal(r.offers.length,0);
});
test('Rechaza ausencia de lista y lotes demasiado grandes',()=>{
 assert.throws(()=>decodeLegacyResponse({}),/offerList/);
 assert.throws(()=>decodeLegacyResponse({offerList:Array(201).fill(block)}),/máximo/);
});
