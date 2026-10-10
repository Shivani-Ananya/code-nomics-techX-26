import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = postgres(url, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
  prepare: false,
  fetch_types: false,
  ssl: process.env.DATABASE_SSL === "true" ? "require" : false,
});

function summarizePlan(name, result) {
  const root = result[0]["QUERY PLAN"][0];
  const nodes = [];
  const visit = (node) => {
    nodes.push({
      node: node["Node Type"],
      relation: node["Relation Name"],
      index: node["Index Name"],
      rows: node["Actual Rows"],
      loops: node["Actual Loops"],
    });
    for (const child of node.Plans || []) visit(child);
  };
  visit(root.Plan);
  return {
    name,
    planningMs: root["Planning Time"],
    executionMs: root["Execution Time"],
    nodes,
  };
}

try {
  const [participant] = await sql`
    SELECT id FROM users WHERE role='participant' ORDER BY id LIMIT 1
  `;
  if (!participant) throw new Error("No dummy participant exists");
  const login = await sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id, role, password_hash, password_salt, locked, disqualified
    FROM users
    WHERE name='LoadBot_001' AND role='participant'
  `;
  const latestJob = await sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT id
    FROM submission_jobs
    WHERE participant_id=${participant.id} AND mode='submit'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const leaderboard = await sql`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT p.user_id
    FROM participants p
    ORDER BY p.solved DESC, p.coding_score DESC, p.helps_used ASC,
      COALESCE(p.completion_time, 9999999999999) ASC, p.user_id ASC
  `;
  const indexes = await sql`
    SELECT tablename, indexname
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename IN ('users', 'participants', 'submission_jobs')
    ORDER BY tablename, indexname
  `;
  console.log(JSON.stringify({
    plans: [
      summarizePlan("participant-login", login),
      summarizePlan("latest-submission-job", latestJob),
      summarizePlan("leaderboard", leaderboard),
    ],
    indexes,
  }, null, 2));
} finally {
  await sql.end({ timeout: 5 });
}
