import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error("SUPABASE_DATABASE_URL is required");

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
