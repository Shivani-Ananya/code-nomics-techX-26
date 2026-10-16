import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const apply = process.argv.includes("--apply");
const database = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  fetch_types: false,
  ssl: process.env.DATABASE_SSL === "true" ? "require" : false,
});

try {
  const accounts = await database`
    SELECT id, name
    FROM users
    WHERE role='participant' AND name ~ '^LoadBot_[0-9]{3}$'
    ORDER BY id`;

  if (accounts.length > 200)
    throw new Error(`Safety check failed: found ${accounts.length} load-test accounts.`);

  if (!apply) {
    console.log(
      JSON.stringify({
        dryRun: true,
        matched: accounts.length,
        firstId: accounts[0]?.id || null,
        lastId: accounts.at(-1)?.id || null,
      }),
    );
  } else {
    const removed = await database.begin(async (tx) => {
      const rows = await tx`
        DELETE FROM users
        WHERE role='participant' AND name ~ '^LoadBot_[0-9]{3}$'
        RETURNING id`;
      return rows.length;
    });
    console.log(JSON.stringify({ dryRun: false, removed }));
  }
} finally {
  await database.end({ timeout: 5 });
}
