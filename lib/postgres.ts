import postgres, { type Sql } from "postgres";

const globalDatabase = globalThis as typeof globalThis & { codeAuctionSql?: Sql };

export function db() {
  if (globalDatabase.codeAuctionSql) return globalDatabase.codeAuctionSql;
  const url = process.env.SUPABASE_DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DATABASE_URL is not configured");
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
