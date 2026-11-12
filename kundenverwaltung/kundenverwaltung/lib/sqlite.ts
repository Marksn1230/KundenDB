import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeMac, normalizeName } from './domain';
type Value = string | number | bigint | null | Uint8Array;
const globalDb = globalThis as unknown as { kundenDb?: DatabaseSync };
export function db() {
  if (globalDb.kundenDb) return globalDb.kundenDb;
  const filename = path.resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH || './data/kunden.sqlite');
  mkdirSync(path.dirname(filename), { recursive: true });
  const existed = existsSync(/* turbopackIgnore: true */ filename);
  const connection = new DatabaseSync(filename);
  connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const version = Number(connection.prepare('PRAGMA user_version').get()!.user_version);
  if (version < 2) {
    connection.exec('PRAGMA wal_checkpoint(FULL)');
    if (existed) copyFileSync(filename, filename + '.before-v2-' + Date.now() + '.bak');
    connection.exec('BEGIN IMMEDIATE');
    try {
      const legacy = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='customers'").get();
      if (legacy) connection.exec('ALTER TABLE customers RENAME TO customers_legacy');
      connection.exec(`
        CREATE TABLE customers (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_number TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL, name_key TEXT NOT NULL, mac_address TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
          provider TEXT CHECK(provider IN ('Art','2GO')), assignee TEXT CHECK(assignee IN ('Marko','Mirko','Satem')),
          points REAL, comment TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0,
          consent_note TEXT NOT NULL DEFAULT '', consent_at TEXT, version INTEGER NOT NULL DEFAULT 1);
        CREATE INDEX customers_match ON customers(name_key,mac_address);
        CREATE TABLE periods (id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          service_start TEXT, service_end TEXT, package_months INTEGER CHECK(package_months IN (1,6,7,12,14)),
          payment_status TEXT NOT NULL CHECK(payment_status IN ('Bezahlt','Unbezahlt','Unbekannt')),
          due_date TEXT, end_source TEXT NOT NULL DEFAULT 'calculated', is_current INTEGER NOT NULL DEFAULT 1);
        CREATE UNIQUE INDEX current_period ON periods(customer_id) WHERE is_current=1;
        CREATE TABLE principals (subject TEXT PRIMARY KEY, username TEXT NOT NULL, name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','employee')), active INTEGER NOT NULL DEFAULT 1, not_before INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE web_sessions (token_hash TEXT PRIMARY KEY, subject TEXT NOT NULL REFERENCES principals(subject),
          access_token TEXT NOT NULL, expires_at INTEGER NOT NULL, csrf TEXT NOT NULL);
        CREATE TABLE oauth_attempts (state TEXT PRIMARY KEY, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE audit_log (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
          entity TEXT NOT NULL, changes TEXT NOT NULL, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE import_previews (id TEXT PRIMARY KEY, actor TEXT NOT NULL, payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0, result TEXT);
        CREATE TABLE integration_settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL DEFAULT 1,
          whatsapp_enabled INTEGER NOT NULL DEFAULT 0, telegram_enabled INTEGER NOT NULL DEFAULT 0,
          offsets TEXT NOT NULL DEFAULT '[-7,0,3]', upcoming_days INTEGER NOT NULL DEFAULT 7,
          telegram_hour INTEGER NOT NULL DEFAULT 8, last_telegram_date TEXT);
        INSERT INTO integration_settings(id) VALUES(1);
        CREATE TABLE deliveries (id INTEGER PRIMARY KEY, channel TEXT NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
          customer_id INTEGER, service_end TEXT, offset_days INTEGER, mode TEXT NOT NULL,
          status TEXT NOT NULL, provider_id TEXT, at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
        CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      `);
      if (legacy) {
        const cols = new Set(connection.prepare('PRAGMA table_info(customers_legacy)').all().map(r => String(r.name)));
        const col = (name: string, fallback: string) => cols.has(name) ? `"${name}"` : fallback;
        connection.exec(`INSERT INTO customers(id,customer_number,name,name_key,mac_address,phone,postal_code,address,provider,assignee,points,comment,consent,consent_note,consent_at,version)
          SELECT id,${col('customer_number', "'K-' || printf('%06d',id)")},name,lower(trim(name)),
          ${col('mac_address', "''")},${col('phone', "''")},${col('postal_code', "''")},${col('address', "''")},${col('provider','NULL')},${col('assignee','NULL')},${col('points','NULL')},${col('comment',"''")},${col('consent','0')},${col('consent_note',"''")},${col('consent_at','NULL')},${col('version','1')} FROM customers_legacy;
          INSERT INTO periods(customer_id,service_start,service_end,package_months,payment_status,due_date,end_source)
          SELECT id,${col('service_start', 'NULL')},${col('service_end', 'NULL')},${col('package_months', 'NULL')},
          ${col('payment_status', "'Unbekannt'")},${col('due_date', 'NULL')},CASE WHEN ${col('service_end','NULL')} IS NOT NULL THEN 'imported' ELSE 'calculated' END FROM customers_legacy;
          DROP TABLE customers_legacy;`);
        for(const row of connection.prepare('SELECT id,name,mac_address,comment FROM customers').all()){
          let mac=String(row.mac_address||''),comment=String(row.comment||'');
          try{if(mac)mac=normalizeMac(mac);}catch{comment+='\nHistorische MAC-Adresse zur Prüfung: '+mac;mac='';}
          connection.prepare('UPDATE customers SET name_key=?,mac_address=?,comment=? WHERE id=?').run(normalizeName(String(row.name)),mac,comment,Number(row.id));
        }
      }
      if (connection.prepare("SELECT name FROM sqlite_master WHERE name='sessions'").get()) connection.exec('DELETE FROM sessions');
      connection.exec('PRAGMA user_version=2; COMMIT');
    } catch (error) { connection.exec('ROLLBACK'); throw error; }
  }
  if (version < 3) connection.exec(`CREATE TABLE IF NOT EXISTS import_receipts (
    profile TEXT NOT NULL, row_hash TEXT NOT NULL, customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    applied_version INTEGER NOT NULL, PRIMARY KEY(profile,row_hash,customer_id)); PRAGMA user_version=3;`);

  if(version<4){
    connection.exec('PRAGMA wal_checkpoint(FULL)');
    if(existed)copyFileSync(filename,filename+'.before-v4-'+Date.now()+'.bak');
    connection.exec('BEGIN IMMEDIATE');
    try{connection.exec("ALTER TABLE customers ADD COLUMN mac_mode TEXT NOT NULL DEFAULT 'mac' CHECK(mac_mode IN ('mac','identifier')); ALTER TABLE integration_settings ADD COLUMN default_country TEXT NOT NULL DEFAULT 'AT'; ALTER TABLE oauth_attempts ADD COLUMN return_to TEXT NOT NULL DEFAULT '/'; CREATE TABLE bulk_batches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('paid','whatsapp')),payload TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'preview',result TEXT); PRAGMA user_version=4; COMMIT");}
    catch(error){connection.exec('ROLLBACK');throw error;}
  }
  if(version<5){
    connection.exec('PRAGMA wal_checkpoint(FULL)');
    if(existed)copyFileSync(filename,filename+'.before-v5-'+Date.now()+'.bak');
    connection.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try{connection.exec(`ALTER TABLE customers ADD COLUMN payment_method TEXT CHECK(payment_method IN ('Bar','Konto'));
ALTER TABLE customers ADD COLUMN payment_account TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN cashier_subject TEXT REFERENCES principals(subject);
ALTER TABLE integration_settings ADD COLUMN telegram_minute INTEGER NOT NULL DEFAULT 0;
ALTER TABLE integration_settings ADD COLUMN telegram_second_time TEXT;
ALTER TABLE web_sessions ADD COLUMN refresh_token TEXT;
ALTER TABLE web_sessions ADD COLUMN token_expires_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE web_sessions ADD COLUMN last_activity_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE web_sessions ADD COLUMN authenticated_at BIGINT NOT NULL DEFAULT 0;
CREATE TABLE maintenance (id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER NOT NULL DEFAULT 0);
INSERT INTO maintenance(id) VALUES(1);

      CREATE TABLE principals_v5(subject TEXT PRIMARY KEY,username TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','employee','cashier')),active INTEGER NOT NULL DEFAULT 1,not_before INTEGER NOT NULL DEFAULT 0);
      INSERT INTO principals_v5 SELECT * FROM principals;
      DELETE FROM web_sessions;
      DROP TABLE principals;
      ALTER TABLE principals_v5 RENAME TO principals;
      UPDATE deliveries SET dedupe_key=dedupe_key||':1' WHERE channel='telegram' AND mode='production' AND length(dedupe_key)=13 AND substr(dedupe_key,1,3)='tg:';
      PRAGMA user_version=5; COMMIT;`);
    }catch(error){connection.exec('ROLLBACK');throw error;}finally{connection.exec('PRAGMA foreign_keys=ON');}
  }
  globalDb.kundenDb = connection;
  return connection;
}
