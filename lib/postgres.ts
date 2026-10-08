import postgres, { type Sql } from "postgres";

const globalDatabase = globalThis as typeof globalThis & {
  codeAuctionSql?: Sql;
};

function resolveDatabaseUrl() {
  // Support both the new local name and the old Supabase name for backwards compat
  const value = (
    process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL
  )?.trim();
  if (!value)
    throw new Error(
      "DATABASE_URL is not configured. Copy .env.example to .env.local and set DATABASE_URL.",
    );
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL is invalid. It must be a valid postgresql:// connection string.",
    );
  }
  if (!/^(postgres|postgresql):$/.test(parsed.protocol))
    throw new Error(
      "DATABASE_URL must use a postgres:// or postgresql:// URL.",
    );
  if (!parsed.hostname || !parsed.username)
    throw new Error(
      "DATABASE_URL is incomplete. It must include host and username.",
    );
  return value;
}

export function db() {
  if (globalDatabase.codeAuctionSql) return globalDatabase.codeAuctionSql;
  const url = resolveDatabaseUrl();
  // SSL: only if explicitly set to true (not needed for local Docker Postgres)
  const sslEnabled =
    (process.env.DATABASE_SSL ?? process.env.SUPABASE_DB_SSL) === "true";
  const sslMode = sslEnabled ? ("require" as const) : false;
  const client = postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE || 10),
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: sslMode,
  });
  if (process.env.NODE_ENV !== "production")
    globalDatabase.codeAuctionSql = client;
  return client;
}
