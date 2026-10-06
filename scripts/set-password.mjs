import { pbkdf2Sync, randomBytes } from "node:crypto";
import postgres from "postgres";

function resolveDatabaseUrl() {
  const value = process.env.SUPABASE_DATABASE_URL?.trim();
  if (!value) throw new Error("SUPABASE_DATABASE_URL is required in .env.local");
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
const password = process.env.NEW_PASSWORD;
const args = process.argv.slice(2);
const idIndex = args.indexOf("--id");
const requestedId = idIndex >= 0 ? String(args[idIndex + 1] || "").trim().toUpperCase() : null;
const allParticipants = args.includes("--all-participants");

if (!url) throw new Error("SUPABASE_DATABASE_URL is required in .env.local");
if (!password || password.length < 12 || password.length > 128) throw new Error("Set NEW_PASSWORD to a value between 12 and 128 characters");
if ((!requestedId && !allParticipants) || (requestedId && allParticipants)) throw new Error("Use either --id HOST-01/CA-1001 or --all-participants");
if (requestedId && !/^(HOST-\d{2}|CA-\d{4})$/.test(requestedId)) throw new Error("Invalid account ID");

const sql = postgres(url, { max: 1, prepare: false, ssl: process.env.SUPABASE_DB_SSL === "false" ? false : "require" });
try {
  const accounts = allParticipants
    ? await sql`SELECT id FROM users WHERE role='participant' ORDER BY id`
    : await sql`SELECT id FROM users WHERE id=${requestedId}`;
  if (!accounts.length) throw new Error("No matching account was found");
  await sql.begin(async (tx) => {
    for (const account of accounts) {
      const salt = randomBytes(16).toString("hex");
      const hash = pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
      await tx`UPDATE users SET password_hash=${hash}, password_salt=${salt} WHERE id=${account.id}`;
    }
  });
  console.log(`Password updated for ${accounts.length} account${accounts.length === 1 ? "" : "s"}.`);
} finally {
  await sql.end();
}
