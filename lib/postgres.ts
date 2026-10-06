import postgres, { type Sql } from "postgres";

const globalDatabase = globalThis as typeof globalThis & { codeAuctionSql?: Sql };

function resolveDatabaseUrl() {
  const value = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!value) throw new Error("SUPABASE_DATABASE_URL is not configured. Copy .env.example to .env.local and set a real Supabase pooler URL.");
  if (/your[-_ ]?supabase|replace-with|example|changeme/i.test(value)) {
    throw new Error("SUPABASE_DATABASE_URL is still a placeholder. Replace it with your real Supabase pooler connection string in .env.local.");
  }
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error("SUPABASE_DATABASE_URL is invalid. Copy the Transaction pooler string from Supabase, remove the [YOUR-PASSWORD] brackets, and URL-encode special password characters."); }
  if (!/^(postgres|postgresql):$/.test(parsed.protocol)) throw new Error("SUPABASE_DATABASE_URL must use a postgres:// or postgresql:// URL.");
  if (!parsed.hostname || !parsed.username || !parsed.password) throw new Error("SUPABASE_DATABASE_URL is incomplete. Copy the complete Transaction pooler string from Supabase.");
  return value;
}

export function db() {
  if (globalDatabase.codeAuctionSql) return globalDatabase.codeAuctionSql;
  const url = resolveDatabaseUrl();
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE || 5),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: process.env.SUPABASE_DB_SSL === "false" ? false : "require",
  });
  if (process.env.NODE_ENV !== "production") globalDatabase.codeAuctionSql = client;
  return client;
}
