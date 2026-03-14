// FILE: src/db.ts
import pg from "pg";

const { Pool } = pg;

// Railway pgvector: Build connection string from components
// The pre-built DATABASE_URL from pgvector is sometimes malformed
let databaseUrl: string | undefined = undefined;

// Option 1: Try pre-built URLs first
if (process.env.DATABASE_URL_PRIVATE || process.env.DATABASE_URL) {
  databaseUrl = process.env.DATABASE_URL_PRIVATE || process.env.DATABASE_URL!;

  // Check if URL is malformed (missing username)
  const urlMatch = databaseUrl.match(/^postgres(ql)?:\/\/([^:@]*):([^@]*)@/);
  if (!urlMatch || !urlMatch[2]) {
    console.warn('⚠️  DATABASE_URL is malformed (missing username), building from components...');
    databaseUrl = undefined; // Force rebuild from components
  }
}

// Option 2: Build from individual PG* environment variables
if (!databaseUrl) {
  const pgHost = process.env.PGHOST_PRIVATE || process.env.PGHOST;
  const pgPort = process.env.PGPORT || '5432';
  const pgDatabase = process.env.PGDATABASE || 'railway';
  const pgUser = process.env.PGUSER || process.env.PGUSERNAME || 'postgres';
  const pgPassword = process.env.PGPASSWORD;

  if (pgHost && pgPassword) {
    databaseUrl = `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDatabase}`;
    console.log('✅ Built DATABASE_URL from PG* components');
  }
}

if (!databaseUrl) {
  console.error('❌ Available DB env vars:', {
    DATABASE_URL_PRIVATE: process.env.DATABASE_URL_PRIVATE ? 'SET' : 'MISSING',
    DATABASE_URL: process.env.DATABASE_URL ? 'SET' : 'MISSING',
    PGHOST: process.env.PGHOST ? 'SET' : 'MISSING',
    PGHOST_PRIVATE: process.env.PGHOST_PRIVATE ? 'SET' : 'MISSING',
    PGUSER: process.env.PGUSER ? 'SET' : 'MISSING',
    PGPASSWORD: process.env.PGPASSWORD ? 'SET' : 'MISSING',
    PGDATABASE: process.env.PGDATABASE ? 'SET' : 'MISSING',
  });
  throw new Error("DATABASE_URL or PG* variables required (Railway Postgres)");
}

// Railway Postgres SSL config
// Some connections don't support SSL:
// - Internal Railway connections (.railway.internal)
// - Railway proxy connections (proxy.rlwy.net) - SSL terminated at proxy
// - Private network connections
//
// DATABASE_SSL env var can override auto-detection:
// - "true" = force SSL
// - "false" = disable SSL
// - unset = auto-detect
const sslOverride = process.env.DATABASE_SSL?.toLowerCase();
const usedPrivateUrl = !!process.env.DATABASE_URL_PRIVATE;
const hasInternalDomain = databaseUrl?.includes('.railway.internal') || databaseUrl?.includes('.internal');
const hasPrivateIP = /(@|\/\/)(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(databaseUrl || '');
const hasRailwayProxy = databaseUrl?.includes('.proxy.rlwy.net');
const isInternalConnection = usedPrivateUrl || hasInternalDomain || hasPrivateIP || hasRailwayProxy;

// Remove sslmode from URL if it's an internal connection (Railway internal doesn't support SSL)
let finalDatabaseUrl = databaseUrl;
if (isInternalConnection && databaseUrl.includes('sslmode=')) {
  finalDatabaseUrl = databaseUrl.replace(/[?&]sslmode=[^&]+/, '');
  // Clean up any trailing ? or && from URL
  finalDatabaseUrl = finalDatabaseUrl.replace(/\?$/, '').replace(/&&/g, '&').replace(/\?&/, '?');
  console.log('🔧 Removed sslmode from internal connection URL');
}

// Debug: Log the DATABASE_URL format (with password masked)
const maskedUrl = finalDatabaseUrl.replace(
  /:([^@]+)@/,
  ':****@'
);
console.log('🔍 DATABASE_URL format:', maskedUrl);
console.log('🔗 Internal connection:', isInternalConnection);

// Explicitly set SSL config
// - DATABASE_SSL=false: explicitly disable
// - DATABASE_SSL=true: explicitly enable
// - Internal/proxy connections: ssl = false (not supported or SSL terminated)
// - External production: ssl = { rejectUnauthorized: false }
// - Development: ssl = undefined (disabled)
let ssl: boolean | { rejectUnauthorized: boolean } | undefined;
if (sslOverride === 'false') {
  ssl = false;
  console.log('🔐 SSL explicitly disabled via DATABASE_SSL=false');
} else if (sslOverride === 'true') {
  ssl = { rejectUnauthorized: false };
  console.log('🔐 SSL explicitly enabled via DATABASE_SSL=true');
} else if (isInternalConnection) {
  ssl = false;
} else if (process.env.NODE_ENV === "production") {
  ssl = { rejectUnauthorized: false };
} else {
  ssl = undefined;
}

export const db = new Pool({
  connectionString: finalDatabaseUrl,
  ssl,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  connectionTimeoutMillis: 30000, // 30 seconds to establish connection
  idleTimeoutMillis: 30000, // Close idle connections after 30 seconds
  query_timeout: 60000, // 60 seconds for queries to complete
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function closeDb() {
  await db.end();
}
