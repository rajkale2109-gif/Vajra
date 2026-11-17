import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.js';
import { CREATE_VIEWS_SQL } from './views.sql.js';

const { Pool } = pg;

export type Database = 
  | ReturnType<typeof drizzlePg<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>;

let dbInstance: Database | null = null;
let rawClient: pg.Pool | PGlite | null = null;

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Media Planner',
  avatar_initials TEXT NOT NULL DEFAULT 'PN',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_connections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  last_successful_sync_at TEXT,
  sync_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  raw_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  platform TEXT NOT NULL,
  objective TEXT NOT NULL,
  status TEXT NOT NULL,
  initial_status TEXT NOT NULL,
  budget INTEGER,
  spent INTEGER,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  learning_flag BOOLEAN NOT NULL DEFAULT FALSE,
  sync_status TEXT NOT NULL DEFAULT 'ok',
  last_synced_at TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_sets (
  id TEXT PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  name TEXT NOT NULL,
  audience TEXT NOT NULL,
  status TEXT NOT NULL,
  initial_status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  ad_set_id TEXT,
  spend NUMERIC,
  impressions INTEGER,
  clicks INTEGER,
  reach INTEGER,
  engagements INTEGER,
  conversions INTEGER,
  revenue NUMERIC,
  data_state TEXT NOT NULL DEFAULT 'complete',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_text TEXT NOT NULL DEFAULT 'Nov 15',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT group_campaign_uniq UNIQUE (group_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_ids TEXT NOT NULL,
  metric TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold NUMERIC NOT NULL,
  comparison_period TEXT NOT NULL,
  recipient TEXT NOT NULL,
  frequency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  last_triggered_at TEXT NOT NULL DEFAULT '—',
  cooldown_until TEXT,
  feedback_key TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_triggers (
  id SERIAL PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL,
  observed_value NUMERIC NOT NULL,
  period_current_start TEXT NOT NULL,
  period_current_end TEXT NOT NULL,
  period_previous_start TEXT NOT NULL,
  period_previous_end TEXT NOT NULL,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  provisional BOOLEAN NOT NULL DEFAULT FALSE,
  entity_label TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  triggered_at TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE alert_triggers ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE alert_triggers ADD COLUMN IF NOT EXISTS provisional BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE alert_triggers ADD COLUMN IF NOT EXISTS entity_label TEXT NOT NULL DEFAULT '';
ALTER TABLE alert_triggers ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE alert_triggers ADD COLUMN IF NOT EXISTS triggered_at TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  detected_at TEXT NOT NULL,
  detected_at_iso TEXT NOT NULL,
  severity TEXT NOT NULL,
  metric TEXT NOT NULL,
  change_display TEXT NOT NULL,
  why_text TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  user_id TEXT REFERENCES users(id),
  user_name TEXT NOT NULL DEFAULT 'Priya Nair',
  timestamp_text TEXT NOT NULL,
  type TEXT NOT NULL,
  action_text TEXT NOT NULL,
  related_entity TEXT NOT NULL DEFAULT '—',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  ts TEXT NOT NULL,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT,
  campaign_id INTEGER,
  ad_set_id TEXT,
  group_id TEXT,
  alert_id TEXT,
  issue_id TEXT,
  objective TEXT,
  platform TEXT,
  severity TEXT,
  data_state TEXT,
  selected_count INTEGER,
  payload TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS severity TEXT;

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  daily_summary_email BOOLEAN NOT NULL DEFAULT TRUE,
  notify_immediate_high BOOLEAN NOT NULL DEFAULT TRUE,
  default_reporting_period TEXT NOT NULL DEFAULT 'Last 7 days vs previous 7 days',
  min_impressions_threshold INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
`;

export async function getDb(databaseUrl?: string): Promise<{ db: Database; raw: pg.Pool | PGlite }> {
  if (dbInstance && rawClient) {
    return { db: dbInstance, raw: rawClient };
  }

  const url = databaseUrl || process.env.DATABASE_URL;

  if (url && url.startsWith('postgres')) {
    const pool = new Pool({ connectionString: url });
    await pool.query(TABLES_DDL);
    try {
      await pool.query(CREATE_VIEWS_SQL);
    } catch (e) {
      console.warn('Notice creating views in postgres:', e);
    }
    const db = drizzlePg(pool, { schema });
    dbInstance = db;
    rawClient = pool;
    return { db, raw: pool };
  }

  // Fallback to embedded in-memory/file PGlite (Real PostgreSQL engine in Node.js)
  const pglite = new PGlite();
  await pglite.exec(TABLES_DDL);
  try {
    await pglite.exec(CREATE_VIEWS_SQL);
  } catch (e) {
    console.warn('Notice creating views in pglite:', e);
  }
  const db = drizzlePglite(pglite, { schema });
  dbInstance = db;
  rawClient = pglite;
  return { db, raw: pglite };
}

export async function closeDb(): Promise<void> {
  if (rawClient) {
    if ('end' in rawClient && typeof rawClient.end === 'function') {
      await rawClient.end();
    } else if ('close' in rawClient && typeof rawClient.close === 'function') {
      await (rawClient as PGlite).close();
    }
    rawClient = null;
    dbInstance = null;
  }
}
