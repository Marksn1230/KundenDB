import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync } from 'node:fs';
import { Pool, types } from 'pg';
import {fail} from './domain';
import { db as sqlite } from './sqlite';
type Value = string|number|bigint|null|Uint8Array;
type QueryResult = { rows:Record<string,unknown>[];rowCount?:number|null };
export type SqlClient = {query:(sql:string,values?:unknown[])=>Promise<QueryResult>;release?:()=>void};
type Context = {client?:SqlClient;driver:'sqlite'|'postgres';inTransaction?:boolean};
const context=new AsyncLocalStorage<Context>();
types.setTypeParser(1082,s=>s);types.setTypeParser(20,Number);
let pool:Pool|undefined;let queue:Promise<unknown>=Promise.resolve();
const backend=()=>context.getStore()?.driver||(process.env.DATABASE_URL?'postgres':'sqlite');
const pg=()=>pool??=new Pool({connectionString:process.env.DATABASE_URL,max:10,connectionTimeoutMillis:10000,statement_timeout:30000});
function exclusive<T>(fn:()=>T|Promise<T>):Promise<T>{const next=queue.then(fn,fn);queue=next.catch(()=>undefined);return next;}
const placeholders=(sql:string)=>{let n=0;return sql.replace(/\?/g,()=>'$'+(++n));};
function normalize<T>(row:Record<string,unknown>):T{for(const key of ['service_start','service_end','due_date','last_telegram_date'])if(row[key] instanceof Date)row[key]=(row[key] as Date).toISOString().slice(0,10);return row as T;}
async function query(sql:string,args:Value[]=[]):Promise<QueryResult>{
  const c=context.getStore()?.client||pg();return c.query(placeholders(sql),args.map(v=>typeof v==='bigint'?Number(v):v));
}
export const db=sqlite;
export async function get<T=Record<string,unknown>>(sql:string,...args:Value[]):Promise<T|undefined>{
  if(backend()==='postgres'){const r=await query(sql,args);return r.rows[0]?normalize<T>(r.rows[0]):undefined;}
  const execute=()=>sqlite().prepare(sql).get(...args) as T|undefined;
  return context.getStore()?.inTransaction?execute():exclusive(execute);
}
export async function all<T=Record<string,unknown>>(sql:string,...args:Value[]):Promise<T[]>{
  if(backend()==='postgres')return (await query(sql,args)).rows.map(r=>normalize<T>(r));
  const execute=()=>sqlite().prepare(sql).all(...args) as T[];
  return context.getStore()?.inTransaction?execute():exclusive(execute);
}
export async function run(sql:string,...args:Value[]){
  if(backend()==='postgres'){
    const table=sql.match(/^\s*INSERT\s+INTO\s+(\w+)/i)?.[1];
    if(table&&['customers','periods','audit_log','deliveries'].includes(table)&&!/\bRETURNING\b/i.test(sql))sql+=' RETURNING id';
    const result=await query(sql,args);return {changes:Number(result.rowCount||0),lastInsertRowid:Number(result.rows[0]?.id||0)};
  }
  const execute=()=>sqlite().prepare(sql).run(...args);
  return context.getStore()?.inTransaction?execute():exclusive(execute);
}
export async function transaction<T>(fn:()=>T|Promise<T>,maintenanceSensitive=false,lockKey=928341705):Promise<T>{
  if(context.getStore()?.inTransaction)return fn();
  if(backend()==='postgres'){
    const inherited=context.getStore()?.client;const client:SqlClient=inherited||await pg().connect();
    try{await client.query('BEGIN');if(maintenanceSensitive){const m=await client.query('SELECT active FROM maintenance WHERE id=1');if(m.rows[0]?.active){const free=await client.query('SELECT pg_try_advisory_xact_lock(928341705) AS free');if(!free.rows[0]?.free)fail('Wartungsmodus: Bitte später erneut versuchen.',503);await client.query('UPDATE maintenance SET active=0 WHERE id=1');}}
      await client.query('SELECT pg_advisory_xact_lock($1)',[lockKey]);
      const result=await context.run({driver:'postgres',client,inTransaction:true},async()=>{if(maintenanceSensitive&&(await get<{active:number}>('SELECT active FROM maintenance WHERE id=1'))?.active)fail('Wartungsmodus: Bitte später erneut versuchen.',503);return fn();});await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{if(!inherited)client.release?.();}
  }
  return exclusive(async()=>{const connection=sqlite();connection.exec('BEGIN IMMEDIATE');
    try{const result=await context.run({driver:'sqlite',inTransaction:true},fn);connection.exec('COMMIT');return result;}
    catch(error){connection.exec('ROLLBACK');throw error;}
  });
}
export async function audit(actor:string,action:string,entity:string,changes:unknown){await run('INSERT INTO audit_log(actor,action,entity,changes) VALUES(?,?,?,?)',actor,action,entity,JSON.stringify(changes));}
export async function migrate(){
  if(backend()==='sqlite'){sqlite();return {driver:'sqlite',version:5};}
  const sql=readFileSync(new URL('../migrations/postgres/001_initial.sql',import.meta.url),'utf8');
  return transaction(async()=>{await query('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY)');
    if(!await get('SELECT version FROM schema_migrations WHERE version=1')){await query(sql);await run('INSERT INTO schema_migrations(version) VALUES(1)');}
    if(!await get('SELECT version FROM schema_migrations WHERE version=2')){await query(readFileSync(new URL('../migrations/postgres/002_customer_workflows.sql',import.meta.url),'utf8'));await run('INSERT INTO schema_migrations(version) VALUES(2)');}
    return {driver:'postgres',version:2};
  });
}
/** Session-level lease keeps outbound claims committed before transport while restore waits for in-flight sends. */
export async function withBusinessLease<T>(fn:()=>Promise<T>):Promise<T>{
 if(backend()==='sqlite'||context.getStore()?.client)return fn();
 const client=await pg().connect();let locked=false;
 try{await client.query('SELECT pg_advisory_lock(928341705)');locked=true;await client.query('UPDATE maintenance SET active=0 WHERE id=1');return await context.run({driver:'postgres',client},fn);}
 finally{if(locked)await client.query('SELECT pg_advisory_unlock(928341705)');client.release();}
}
export async function sessionTransaction<T>(fn:()=>T|Promise<T>){return transaction(fn,false,928341707);}
export async function businessTransaction<T>(fn:()=>T|Promise<T>){return transaction(fn,true);}
export async function closeDatabase(){if(pool){await pool.end();pool=undefined;}}
/** Isolated SQL-client scope for migrations and database integration tests; never exposed over HTTP. */
export function withPostgresClient<T>(client:SqlClient,fn:()=>Promise<T>){return context.run({driver:'postgres',client},fn);}
