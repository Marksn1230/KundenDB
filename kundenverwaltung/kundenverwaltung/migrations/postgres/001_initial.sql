CREATE TABLE IF NOT EXISTS customers (
 id SERIAL PRIMARY KEY, customer_number TEXT NOT NULL UNIQUE, name TEXT NOT NULL, name_key TEXT NOT NULL,
 mac_address TEXT NOT NULL DEFAULT '', mac_mode TEXT NOT NULL DEFAULT 'mac' CHECK(mac_mode IN ('mac','identifier')),
 phone TEXT NOT NULL DEFAULT '', postal_code TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
 provider TEXT CHECK(provider IN ('Art','2GO')), assignee TEXT CHECK(assignee IN ('Marko','Mirko','Satem')),
 points DOUBLE PRECISION, comment TEXT NOT NULL DEFAULT '', consent INTEGER NOT NULL DEFAULT 0 CHECK(consent IN (0,1)),
 consent_note TEXT NOT NULL DEFAULT '', consent_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS customers_match ON customers(name_key,mac_address);
CREATE TABLE IF NOT EXISTS periods (
 id SERIAL PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 service_start DATE,service_end DATE,package_months INTEGER CHECK(package_months IN(1,6,7,12,14)),
 payment_status TEXT NOT NULL CHECK(payment_status IN('Bezahlt','Unbezahlt','Unbekannt')),
 due_date DATE,end_source TEXT NOT NULL DEFAULT 'calculated',is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN(0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS current_period ON periods(customer_id) WHERE is_current=1;
CREATE TABLE IF NOT EXISTS principals(subject TEXT PRIMARY KEY,username TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('admin','employee')),active INTEGER NOT NULL DEFAULT 1,not_before BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS web_sessions(token_hash TEXT PRIMARY KEY,subject TEXT NOT NULL REFERENCES principals(subject),access_token TEXT NOT NULL,expires_at BIGINT NOT NULL,csrf TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS oauth_attempts(state TEXT PRIMARY KEY,verifier TEXT NOT NULL,nonce TEXT NOT NULL,expires_at BIGINT NOT NULL,return_to TEXT NOT NULL DEFAULT '/');
CREATE TABLE IF NOT EXISTS audit_log(id SERIAL PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity TEXT NOT NULL,changes TEXT NOT NULL,
 at TEXT NOT NULL DEFAULT(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
CREATE TABLE IF NOT EXISTS import_previews(id TEXT PRIMARY KEY,actor TEXT NOT NULL,payload TEXT NOT NULL,expires_at BIGINT NOT NULL,consumed INTEGER NOT NULL DEFAULT 0,result TEXT);
CREATE TABLE IF NOT EXISTS integration_settings(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 1,whatsapp_enabled INTEGER NOT NULL DEFAULT 0,telegram_enabled INTEGER NOT NULL DEFAULT 0,offsets TEXT NOT NULL DEFAULT '[-7,0,3]',upcoming_days INTEGER NOT NULL DEFAULT 7,telegram_hour INTEGER NOT NULL DEFAULT 8,last_telegram_date DATE,default_country TEXT NOT NULL DEFAULT 'AT');
INSERT INTO integration_settings(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS deliveries(id SERIAL PRIMARY KEY,channel TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,customer_id INTEGER,service_end DATE,offset_days INTEGER,mode TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,
 at TEXT NOT NULL DEFAULT(to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS import_receipts(profile TEXT NOT NULL,row_hash TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,applied_version INTEGER NOT NULL,PRIMARY KEY(profile,row_hash,customer_id));
CREATE TABLE IF NOT EXISTS bulk_batches(id TEXT PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN('paid','whatsapp')),payload TEXT NOT NULL,expires_at BIGINT NOT NULL,status TEXT NOT NULL DEFAULT 'preview',result TEXT);
