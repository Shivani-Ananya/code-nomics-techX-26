import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

function resolveDatabaseUrl() {
  const value = (
    process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL
  )?.trim();
  if (!value)
    throw new Error(
      "DATABASE_URL is required. Copy .env.example to .env.local and set DATABASE_URL.",
    );
  try {
    const parsed = new URL(value);
    if (!/^(postgres|postgresql):$/.test(parsed.protocol))
      throw new Error(
        "DATABASE_URL must use a postgres:// or postgresql:// URL.",
      );
    return value;
  } catch (e) {
    if (e instanceof Error && e.message.includes("must use")) throw e;
    throw new Error(
      "DATABASE_URL must be a valid postgres:// connection string.",
    );
  }
}

const url = resolveDatabaseUrl();
const sslEnabled =
  (process.env.DATABASE_SSL ?? process.env.SUPABASE_DB_SSL) === "true";
const sslMode = sslEnabled ? "require" : false;

const sql = postgres(url, {
  max: 1,
  prepare: false,
  ssl: sslMode,
});

try {
  await sql`CREATE TABLE IF NOT EXISTS app_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const directory = path.resolve("supabase/migrations");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const applied = await sql`SELECT 1 FROM app_migrations WHERE name=${file}`;
    if (applied.length) {
      console.log(`Skipped ${file} (already applied)`);
      continue;
    }
    const migration = await readFile(path.join(directory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`INSERT INTO app_migrations (name) VALUES (${file})`;
    });
    console.log(`Applied ${file}`);
  }
  console.log("All migrations complete.");
} finally {
  await sql.end();
}
