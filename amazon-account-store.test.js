'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const store=require('./amazon-account-store');
function fakePool(){
  const state={accounts:[],nextId:1,migration:false,legacy:[]};
  const sql=async(sql,params=[])=>{
    sql=sql.replace(/\s+/g,' ').trim();
    const rows=values=>({rows:values,rowCount:values.length});
    if(sql.startsWith('CREATE TABLE')||sql.startsWith('CREATE UNIQUE INDEX')||sql.startsWith('SELECT pg_advisory_xact_lock'))return rows([]);
    if(sql.startsWith('INSERT INTO aa_lwa_schema_migrations')){if(state.migration)return rows([]);state.migration=true;return rows([{name:'accounts_v2_2026_11'}])}
    if(sql.startsWith('INSERT INTO aa_lwa_accounts(user_id,amazon_user_id,linked_at,active) SELECT')){
      for(const l of state.legacy)if(!state.accounts.some(a=>a.amazon_user_id===l.amazon_user_id))state.accounts.push({...l,id:state.nextId++,email:null,display_name:null,active:true});
      return rows([]);
    }
    if(sql.startsWith('SELECT id,email,display_name,linked_at,active FROM'))return rows(state.accounts.filter(a=>String(a.user_id)===String(params[0])).sort((a,b)=>Number(b.active)-Number(a.active)||b.id-a.id));
    if(sql.startsWith('SELECT id,user_id FROM aa_lwa_accounts WHERE amazon_user_id'))return rows(state.accounts.filter(a=>a.amazon_user_id===params[0]));
    if(sql.startsWith('SELECT count(*)::int AS count FROM aa_lwa_accounts'))return rows([{count:state.accounts.filter(a=>String(a.user_id)===String(params[0])).length}]);
    if(sql.startsWith('UPDATE aa_lwa_accounts SET active=FALSE')){for(const a of state.accounts)if(String(a.user_id)===String(params[0]))a.active=false;return rows([])}
    if(sql.startsWith('UPDATE aa_lwa_accounts SET email=')){
      const x=state.accounts.find(a=>String(a.id)===String(params[0])&&String(a.user_id)===String(params[1]));assert.ok(x);x.email=params[2];x.display_name=params[3];x.active=true;return rows([]);
    }
    if(sql.startsWith('INSERT INTO aa_lwa_accounts(user_id,amazon_user_id,email')){
      const [user_id,amazon_user_id,email,display_name]=params;
      if(state.accounts.some(a=>a.amazon_user_id===amazon_user_id)){const e=new Error('duplicate');e.code='23505';throw e}
      const a={id:state.nextId++,user_id,amazon_user_id,email,display_name,active:true,linked_at:new Date().toISOString()};state.accounts.push(a);return rows([{id:a.id}]);
    }
    if(sql.startsWith('SELECT id FROM aa_lwa_accounts WHERE id=$1'))return rows(state.accounts.filter(a=>String(a.id)===String(params[0])&&String(a.user_id)===String(params[1])));
    if(sql.startsWith('UPDATE aa_lwa_accounts SET active=TRUE WHERE id=$1')){const x=state.accounts.find(a=>String(a.id)===String(params[0])&&String(a.user_id)===String(params[1]));if(x)x.active=true;return rows([])}
    if(sql.startsWith('DELETE FROM aa_lwa_accounts WHERE id=$1')){
      const index=state.accounts.findIndex(a=>String(a.id)===String(params[0])&&String(a.user_id)===String(params[1]));
      if(index<0)return rows([]);const [x]=state.accounts.splice(index,1);return rows([{active:x.active}]);
    }
    if(sql.startsWith('UPDATE aa_lwa_accounts SET active=TRUE WHERE id=(')){
      const candidate=state.accounts.filter(a=>String(a.user_id)===String(params[0])).sort((a,b)=>b.id-a.id)[0];if(candidate)candidate.active=true;return rows([]);
    }
    if(sql.startsWith('SELECT id FROM aa_lwa_accounts WHERE user_id=$1 AND active=TRUE'))return rows(state.accounts.filter(a=>String(a.user_id)===String(params[0])&&a.active).map(a=>({id:a.id})));
    throw new Error('Unsupported SQL in test: '+sql.slice(0,150));
  };
  return {state,query:sql,async connect(){let snapshot;return {async query(sqlText,params){if(sqlText==='BEGIN'){snapshot=structuredClone(state);return{rows:[],rowCount:0}}if(sqlText==='ROLLBACK'){Object.assign(state,snapshot);return{rows:[],rowCount:0}}if(sqlText==='COMMIT')return{rows:[],rowCount:0};return sql(sqlText,params)},release(){}}}};
}
const profile=(id,email)=>({userId:'amzn1.account.'+id,email,name:'Nombre '+id,access_token:'NEVER_SAVE'});
test('migrates a legacy identity exactly once',async()=>{
 const db=fakePool();db.state.legacy.push({user_id:1,amazon_user_id:'amzn1.account.old',linked_at:new Date().toISOString()});
 await store.init(db);assert.equal((await store.listAccounts(db,1)).length,1);
 await store.init(db);assert.equal((await store.listAccounts(db,1)).length,1);
});
test('multiple accounts stay private to the Detroit user; active selection and removal',async()=>{
 const db=fakePool();const id1=await store.linkAccount(db,1,profile('first','first@example.com'));
 const id2=await store.linkAccount(db,1,profile('second','second@example.com'));
 assert.equal((await store.listAccounts(db,1)).length,2);
 assert.equal((await store.listAccounts(db,2)).length,0);
 assert.equal((await store.listAccounts(db,1)).find(x=>x.active).id,id2);
 await assert.rejects(store.activateAccount(db,2,id1),{code:'NOT_FOUND'});
 await store.activateAccount(db,1,id1);
 assert.equal((await store.listAccounts(db,1)).find(x=>x.active).id,id1);
 await store.removeAccount(db,1,id1);
 assert.equal((await store.listAccounts(db,1)).find(x=>x.active).id,id2);
 await store.removeActiveAccount(db,1);assert.equal((await store.listAccounts(db,1)).length,0);
});
test('Amazon identity cannot be linked into another Detroit user',async()=>{
 const db=fakePool();await store.linkAccount(db,1,profile('first','first@example.com'));
 await assert.rejects(store.linkAccount(db,2,profile('first','first@example.com')),{code:'ALREADY_LINKED'});
});
test('relinking refreshes email without duplicating, and never stores Amazon secrets',async()=>{
 const db=fakePool();await store.linkAccount(db,1,profile('first','old@example.com'));
 await store.linkAccount(db,1,profile('first','updated@example.com'));
 const accounts=await store.listAccounts(db,1);assert.equal(accounts.length,1);assert.equal(accounts[0].email,'updated@example.com');
 assert.ok(!JSON.stringify(db.state.accounts).includes('NEVER_SAVE'));
});
test('limit of five identities and reject invalid identifiers',async()=>{
 const db=fakePool();for(let i=0;i<store.MAX_ACCOUNTS;i++)await store.linkAccount(db,1,profile('p'+i,'x'+i+'@example.com'));
 await assert.rejects(store.linkAccount(db,1,profile('p6','x6@example.com')),{code:'LIMIT_REACHED'});
 await assert.rejects(store.removeAccount(db,1,'not-a-number'),{code:'INVALID_ACCOUNT'});
});
