import postgres, { type Sql } from "postgres";

const globalDatabase = globalThis as typeof globalThis & {
  codeAuctionSql?: Sql;
  codeAuctionConnectionIds?: Set<number>;
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
  const requestedPoolSize = Number(process.env.DATABASE_POOL_SIZE || 10);
  const poolSize = Number.isFinite(requestedPoolSize)
    ? Math.min(10, Math.max(1, Math.trunc(requestedPoolSize)))
    : 10;
  const connectionIds =
    globalDatabase.codeAuctionConnectionIds || new Set<number>();
  globalDatabase.codeAuctionConnectionIds = connectionIds;
  const client = postgres(url, {
    max: poolSize,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
    fetch_types: false,
    ssl: sslMode,
    connection: {
      application_name: "techx-code-auction",
      statement_timeout: 10000,
      lock_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
    },
    debug: (connection) => {
      connectionIds.add(connection);
    },
  });
  globalDatabase.codeAuctionSql = client;
  return client;
}

export function databaseRuntimeMetrics() {
  return {
    configuredPoolSize: Math.min(
      10,
      Math.max(1, Math.trunc(Number(process.env.DATABASE_POOL_SIZE || 10) || 10)),
    ),
    observedConnections:
      globalDatabase.codeAuctionConnectionIds?.size || 0,
  };
}

export async function closeDatabase() {
  const client = globalDatabase.codeAuctionSql;
  globalDatabase.codeAuctionSql = undefined;
  globalDatabase.codeAuctionConnectionIds?.clear();
  if (client) await client.end({ timeout: 5 });
}
