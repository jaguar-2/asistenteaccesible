'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {decodeBatch,PayloadError}=require('./flex-batch-adapter');
const serviceId='e7bd4b3d-a69c-430b-a449-83546a7f718c';
const start=Math.floor(Date.parse('2026-11-16T14:00:00Z')/1000);
const legacy={offerId:'sample-legacy',serviceAreaId:serviceId,startTime:start,endTime:start+10800,rateInfo:{priceAmount:142},hidden:false};
const canonical={id:'sample-group',station:'DDT6',price:142,start:'2026-11-16T14:00:00Z',end:'2026-11-16T17:00:00Z'};
test('legacy list is decoded and labeled unverified',()=>{
 const r=decodeBatch({format:'legacy-offer-list',stationMap:{[serviceId]:'DDT6'},payload:{offerList:[legacy]}});
 assert.equal(r.offers.length,1);assert.equal(r.offers[0].station,'DDT6');assert.equal(r.offers[0].model,'legacy-offer-list');assert.equal(r.source,'external-legacy-unverified');assert.equal(r.bookable,false);
});
test('legacy format rejects unmapped stations and skips hidden records',()=>{
 const r=decodeBatch({format:'legacy-offer-list',payload:{offerList:[legacy,{...legacy,offerId:'hidden',hidden:true}]}});
 assert.equal(r.offers.length,0);assert.equal(r.skipped.length,2);
});
test('group bridge flattens normalized offers preserving group id only',()=>{
 const r=decodeBatch({format:'detroit-group-v1',payload:{groups:[{groupId:'G-A',offers:[canonical]}]}});
 assert.equal(r.offers.length,1);assert.equal(r.offers[0].groupId,'G-A');assert.equal(r.offers[0].model,'detroit-group-v1');assert.equal(r.verifiedAmazonSource,false);
 assert.equal(r.offers[0].provenance,'detroit-bridge-unverified');
});
test('group metadata without details cannot become an offer',()=>{
 const r=decodeBatch({format:'detroit-group-v1',payload:{groups:[{groupId:'G-A',availableCount:18}]}});
 assert.equal(r.offers.length,0);assert.equal(r.skipped.length,1);
});
test('group bridge skips malformed, hidden and fake-priced rows',()=>{
 const r=decodeBatch({format:'detroit-group-v1',payload:{groups:[{groupId:'G-A',offers:[{...canonical,price:'142'},{...canonical,hidden:true},{...canonical,offerId:'abc'}]}]}});
 assert.equal(r.offers.length,1);assert.equal(r.skipped.length,2);
});
test('requires an explicit schema, never guesses native GetOfferGroups',()=>{
 assert.throws(()=>decodeBatch({format:'GetOfferGroups',payload:{groups:[]}}),PayloadError);
 assert.throws(()=>decodeBatch({format:'detroit-group-v1',payload:{offerGroups:[]}}),PayloadError);
});
test('requires bounded groups and records',()=>{
 assert.throws(()=>decodeBatch({format:'detroit-group-v1',payload:{groups:Array.from({length:13},(_,i)=>({groupId:'G'+i}))}}),/12/);
 assert.throws(()=>decodeBatch({format:'detroit-group-v1',payload:{groups:[{groupId:'G-A',offers:Array(61).fill(canonical)}]}}),/60/);
 assert.throws(()=>decodeBatch({format:'legacy-offer-list',payload:{offerList:Array(61).fill(legacy)}}),/60/);
});
test('never accepts arbitrary unknown formats or raw credentials',()=>{
 assert.throws(()=>decodeBatch({format:'raw-flex-response',payload:{offerList:[]}}),/Formato/);
 assert.throws(()=>decodeBatch({format:'legacy-offer-list',stationMap:[] ,payload:{offerList:[]}}),/stationMap/);
});
test('rejects prototype property as station without explicit mapping',()=>{
 const r=decodeBatch({format:'legacy-offer-list',payload:{offerList:[{...legacy,serviceAreaId:'toString'}]}});
 assert.equal(r.offers.length,0);assert.match(r.skipped[0].reason,/mapeo/i);
});
