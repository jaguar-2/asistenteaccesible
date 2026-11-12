'use strict';
// Only Amazon LWA profile identities. No Amazon passwords, tokens or Flex sessions.
const MAX_ACCOUNTS=5;

class AccountLinkError extends Error {
  constructor(code){super(code);this.code=code}
}

async function withTransaction(pool,work){
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await work(client);await client.query('COMMIT');return value}
  catch(e){try{await client.query('ROLLBACK')}catch{}throw e}
  finally{client.release()}
}

async function init(pool){
  await pool.query(`CREATE TABLE IF NOT EXISTS aa_lwa_pending (
    state_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES aa_users(id) ON DELETE CASCADE,
    verifier TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`);
  // Keep the legacy table for deployments that still have an older service version.
  await pool.query(`CREATE TABLE IF NOT EXISTS aa_lwa_links (
    user_id BIGINT PRIMARY KEY REFERENCES aa_users(id) ON DELETE CASCADE,
    amazon_user_id TEXT NOT NULL UNIQUE,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS aa_lwa_accounts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES aa_users(id) ON DELETE CASCADE,
    amazon_user_id TEXT NOT NULL UNIQUE,
    email TEXT,
    display_name TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    active BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id,amazon_user_id)
  )`);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS aa_lwa_one_active_per_user ON aa_lwa_accounts(user_id) WHERE active');
  await pool.query('CREATE TABLE IF NOT EXISTS aa_lwa_schema_migrations(name TEXT PRIMARY KEY)');
  await withTransaction(pool,async client=>{
    // Transaction lock prevents two overlapping Render instances from migrating twice.
    await client.query('SELECT pg_advisory_xact_lock(681359711)');
    const marker=await client.query(`INSERT INTO aa_lwa_schema_migrations(name)
      VALUES('accounts_v2_2026_11') ON CONFLICT DO NOTHING RETURNING name`);
    if(marker.rowCount){
      await client.query(`INSERT INTO aa_lwa_accounts(user_id,amazon_user_id,linked_at,active)
        SELECT user_id,amazon_user_id,linked_at,TRUE FROM aa_lwa_links
        ON CONFLICT(amazon_user_id) DO NOTHING`);
    }
  });
}

async function listAccounts(pool,userId){
  const rows=await pool.query(`SELECT id,email,display_name,linked_at,active
    FROM aa_lwa_accounts WHERE user_id=$1 ORDER BY active DESC, linked_at DESC,id DESC`,[userId]);
  return rows.rows.map(r=>({id:String(r.id),email:r.email||null,name:r.display_name||null,linkedAt:r.linked_at,active:r.active}));
}

async function linkAccount(pool,userId,profile){
  if(typeof profile?.userId!=='string'||!/^amzn1\./.test(profile.userId)||profile.userId.length>255)throw new AccountLinkError('INVALID_PROFILE');
  const email=typeof profile.email==='string'&&profile.email.length<=320?profile.email:null;
  const name=typeof profile.name==='string'&&profile.name.length<=160?profile.name:null;
  try{return await withTransaction(pool,async client=>{
    const existing=await client.query('SELECT id,user_id FROM aa_lwa_accounts WHERE amazon_user_id=$1 FOR UPDATE',[profile.userId]);
    if(existing.rowCount && String(existing.rows[0].user_id)!==String(userId))throw new AccountLinkError('ALREADY_LINKED');
    if(!existing.rowCount){
      const count=await client.query('SELECT count(*)::int AS count FROM aa_lwa_accounts WHERE user_id=$1',[userId]);
      if(Number(count.rows[0].count)>=MAX_ACCOUNTS)throw new AccountLinkError('LIMIT_REACHED');
    }
    await client.query('UPDATE aa_lwa_accounts SET active=FALSE WHERE user_id=$1 AND active=TRUE',[userId]);
    if(existing.rowCount){
      await client.query(`UPDATE aa_lwa_accounts SET email=$3,display_name=$4,linked_at=now(),active=TRUE
        WHERE id=$1 AND user_id=$2`,[existing.rows[0].id,userId,email,name]);
      return String(existing.rows[0].id);
    }
    const inserted=await client.query(`INSERT INTO aa_lwa_accounts(user_id,amazon_user_id,email,display_name,active)
      VALUES($1,$2,$3,$4,TRUE) RETURNING id`,[userId,profile.userId,email,name]);
    return String(inserted.rows[0].id);
  })}catch(e){if(e?.code==='23505')throw new AccountLinkError('ALREADY_LINKED');throw e}
}

function checkAccountId(id){if(!/^[1-9]\d{0,15}$/.test(String(id)))throw new AccountLinkError('INVALID_ACCOUNT')}
async function activateAccount(pool,userId,id){
  checkAccountId(id);
  return withTransaction(pool,async client=>{
    const selected=await client.query('SELECT id FROM aa_lwa_accounts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
    if(!selected.rowCount)throw new AccountLinkError('NOT_FOUND');
    await client.query('UPDATE aa_lwa_accounts SET active=FALSE WHERE user_id=$1 AND active=TRUE',[userId]);
    await client.query('UPDATE aa_lwa_accounts SET active=TRUE WHERE id=$1 AND user_id=$2',[id,userId]);
    return true;
  });
}
async function removeAccount(pool,userId,id){
  checkAccountId(id);
  return withTransaction(pool,async client=>{
    const removed=await client.query('DELETE FROM aa_lwa_accounts WHERE id=$1 AND user_id=$2 RETURNING active',[id,userId]);
    if(!removed.rowCount)throw new AccountLinkError('NOT_FOUND');
    if(removed.rows[0].active){
      await client.query(`UPDATE aa_lwa_accounts SET active=TRUE WHERE id=(
        SELECT id FROM aa_lwa_accounts WHERE user_id=$1 ORDER BY linked_at DESC,id DESC LIMIT 1
      )`,[userId]);
    }
    return true;
  });
}
async function removeActiveAccount(pool,userId){
  const r=await pool.query('SELECT id FROM aa_lwa_accounts WHERE user_id=$1 AND active=TRUE',[userId]);
  if(!r.rowCount)return false;
  return removeAccount(pool,userId,r.rows[0].id);
}
module.exports={MAX_ACCOUNTS,AccountLinkError,init,listAccounts,linkAccount,activateAccount,removeAccount,removeActiveAccount};
