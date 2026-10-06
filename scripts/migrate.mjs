import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

function resolveDatabaseUrl() {
  const value = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!value) throw new Error("SUPABASE_DATABASE_URL is required. Copy .env.example to .env.local and set a real Supabase pooler URL.");
  if (/your[-_ ]?supabase|replace-with|example|changeme/i.test(value)) throw new Error("SUPABASE_DATABASE_URL is still a placeholder. Replace it with your real Supabase pooler connection string in .env.local.");
  try {
    const parsed = new URL(value);
    if (!/^(postgres|postgresql):$/.test(parsed.protocol)) throw new Error("SUPABASE_DATABASE_URL must use a postgres:// or postgresql:// URL.");
    return value;
  } catch {
    throw new Error("SUPABASE_DATABASE_URL must be a valid postgres:// or postgresql:// connection string.");
  }
}

const url = resolveDatabaseUrl();

const sql = postgres(url, {
  max: 1,
  prepare: false,
  ssl: process.env.SUPABASE_DB_SSL === "false" ? false : "require",
});

try {
  await sql`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const directory = path.resolve("supabase/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const applied = await sql`SELECT 1 FROM app_migrations WHERE name=${file}`;
    if (applied.length) continue;
    const migration = await readFile(path.join(directory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO app_migrations (name) VALUES (${file})`;
    });
    console.log(`Applied ${file}`);
  }
} finally {
  await sql.end();
}
