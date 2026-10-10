import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const sql = postgres(url, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
  ssl: process.env.DATABASE_SSL === "true" ? "require" : false,
  prepare: false,
  fetch_types: false,
});

try {
  const [limits] = await sql`
    SELECT
      current_setting('max_connections')::int AS max_connections,
      current_setting('superuser_reserved_connections')::int AS reserved_connections,
      (SELECT count(*)::int FROM pg_stat_activity) AS current_connections,
      (SELECT count(*)::int FROM pg_stat_activity WHERE state='active') AS active_connections
  `;
  const [identity] = await sql`
    SELECT current_database() AS database, current_user AS current_user
  `;
  const activity = await sql`
    SELECT application_name, state, wait_event_type, wait_event,
      left(query, 100) AS query
    FROM pg_stat_activity
    WHERE datname=current_database() AND state <> 'idle'
    ORDER BY state, wait_event NULLS FIRST
  `;
  console.log(JSON.stringify({ connected: true, limits, identity, activity }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
