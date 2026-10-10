import {
  clearSessionCookie,
  createSession,
  hashPassword,
  randomSalt,
  readSession,
  safeEqual,
  sessionCookie,
} from "@/lib/event-auth";
import { db, ensureSeeded, remaining } from "@/lib/event-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;
type Row = Record<string, unknown>;
const json = (data: unknown, status = 200, headers?: HeadersInit) => {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store, max-age=0");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  return Response.json(data, { status, headers: h });
};
const queueEnabled = () => process.env.JUDGE_QUEUE_ENABLED !== "false";
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const SHARED_CACHE_TTL_MS = 10_000;
const DATABASE_OPERATION_TIMEOUT_MS = Number(
  process.env.DATABASE_OPERATION_TIMEOUT_MS || 7_500,
);

type Trace = {
  id: string;
  action: string;
  startedAt: number;
  queries: { name: string; durationMs: number }[];
};

type SharedEventData = {
  questionCount: number;
  quiz: Row[];
  problems: Row[];
};

let sharedEventCache:
  | { expiresAt: number; value: SharedEventData }
  | undefined;
let sharedEventLoad: Promise<SharedEventData> | undefined;

let roundsCache:
  | { expiresAt: number; value: Row[] }
  | undefined;
let roundsLoad: Promise<Row[]> | undefined;

// Cache user role/locked/disqualified status for 30s per session — avoids a DB hit on every POST
const userRoleCache = new Map<string, { expiresAt: number; role: string; locked: boolean; disqualified: boolean }>();


function createTrace(action: string): Trace {
  return {
    id: crypto.randomUUID(),
    action,
    startedAt: performance.now(),
    queries: [],
  };
}

async function timed<T>(trace: Trace, name: string, operation: () => Promise<T>) {
  const startedAt = performance.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Database operation timed out: ${name}`)),
          DATABASE_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    trace.queries.push({
      name,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  }
}

function finishTrace(trace: Trace, status: number) {
  const durationMs = Math.round((performance.now() - trace.startedAt) * 10) / 10;
  if (
    process.env.PERF_LOG_ALL === "true" ||
    durationMs >= Number(process.env.PERF_SLOW_REQUEST_MS || 500)
  )
    console.info(
      JSON.stringify({
        type: "api-performance",
        requestId: trace.id,
        action: trace.action,
        status,
        durationMs,
        queries: trace.queries,
      }),
    );
}

function invalidateSharedEventCache() {
  sharedEventCache = undefined;
  sharedEventLoad = undefined;
  roundsCache = undefined;
  roundsLoad = undefined;
  userRoleCache.clear();
}

async function sharedEventData(database: ReturnType<typeof db>, trace: Trace) {
  const now = Date.now();
  if (sharedEventCache && sharedEventCache.expiresAt > now)
    return sharedEventCache.value;
  if (sharedEventLoad) return sharedEventLoad;
  sharedEventLoad = (async () => {
    const [quiz, problems] = await Promise.all([
      timed(trace, "shared.quiz", () =>
        database<Row[]>`SELECT id, category, difficulty, prompt, options_json AS options, coin_value AS "coinValue" FROM quiz_questions ORDER BY id`,
      ),
      timed(trace, "shared.problems", () =>
        database<Row[]>`SELECT id, title, difficulty, points, statement, input_format AS "inputFormat", output_format AS "outputFormat", sample_input AS "sampleInput", sample_output AS "sampleOutput" FROM coding_questions ORDER BY id`,
      ),
    ]);
    const value = { questionCount: problems.length, quiz, problems };
    sharedEventCache = { expiresAt: Date.now() + SHARED_CACHE_TTL_MS, value };
    return value;
  })().finally(() => {
    sharedEventLoad = undefined;
  });
  return sharedEventLoad;
}

function formatRounds(rounds: Row[]) {
  return Object.fromEntries(
    rounds.map((round) => [
      round.id,
      {
        ...round,
        started_at: round.started_at ? Number(round.started_at) : null,
        paused_at: round.paused_at ? Number(round.paused_at) : null,
        remainingSeconds: remaining({
          status: String(round.status),
          duration_seconds: Number(round.duration_seconds),
          started_at: round.started_at ? Number(round.started_at) : null,
          paused_at: round.paused_at ? Number(round.paused_at) : null,
          accumulated_pause_seconds: Number(round.accumulated_pause_seconds),
        }),
      },
    ]),
  );
}

async function loginClientKey(request: Request, id: string) {
  const address =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${id}|${address}`),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function recordLoginFailure(key: string) {
  const database = db();
  const now = Date.now();
  const [row] = await database<
    { failed_count: number; first_failed_at: string }[]
  >`SELECT failed_count, first_failed_at FROM login_rate_limits WHERE client_key=${key}`;
  const within = row && now - Number(row.first_failed_at) <= LOGIN_WINDOW_MS;
  const count = within ? row.failed_count + 1 : 1;
  const first = within ? Number(row.first_failed_at) : now;
  const blocked = count >= 5 ? now + LOGIN_BLOCK_MS : null;
  await database`INSERT INTO login_rate_limits (client_key, failed_count, first_failed_at, blocked_until, updated_at)
    VALUES (${key}, ${count}, ${first}, ${blocked}, ${now})
    ON CONFLICT (client_key) DO UPDATE SET failed_count=excluded.failed_count, first_failed_at=excluded.first_failed_at, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at`;
}

async function legacySnapshot(request: Request) {
  const session = await readSession(request);
  if (!session) return json({ error: "Authentication required" }, 401);
  const database = db();
  const rounds = await database<Row[]>`SELECT * FROM rounds ORDER BY id`;
  const roundMap = Object.fromEntries(
    rounds.map((r) => [
      r.id,
      {
        ...r,
        started_at: r.started_at ? Number(r.started_at) : null,
        paused_at: r.paused_at ? Number(r.paused_at) : null,
        remainingSeconds: remaining({
          status: String(r.status),
          duration_seconds: Number(r.duration_seconds),
          started_at: r.started_at ? Number(r.started_at) : null,
          paused_at: r.paused_at ? Number(r.paused_at) : null,
          accumulated_pause_seconds: Number(r.accumulated_pause_seconds),
        }),
      },
    ]),
  );
  const leaderboard =
    await database`SELECT u.id, u.name, u.college, p.coins, p.quiz_correct AS "quizCorrect", p.coding_score AS "codingScore", p.language, p.current_question AS "currentQuestion", p.solved, p.helps_used AS "helpsUsed", p.completion_time AS "completionTime", p.status, p.last_seen::float8 AS "lastSeen", p.security_violation_count AS "securityViolationCount", p.security_last_violation_at::float8 AS "securityLastViolationAt", p.security_last_violation_reason AS "securityLastViolationReason", u.locked, u.disqualified FROM participants p JOIN users u ON u.id=p.user_id ORDER BY p.solved DESC, p.coding_score DESC, p.helps_used ASC, COALESCE(p.completion_time, 9999999999999) ASC`;
  const [{ questionCount }] = await database<
    { questionCount: number }[]
  >`SELECT count(*)::int AS "questionCount" FROM coding_questions`;
  const [{ totalQueued }] = await database<
    { totalQueued: number }[]
  >`SELECT count(*)::int AS "totalQueued" FROM submission_jobs WHERE status IN ('queued','running')`;
  if (session.role === "host")
    return json({
      session,
      rounds: roundMap,
      leaderboard,
      questionCount,
      serverTime: Date.now(),
      judgeConfigured: queueEnabled(),
      totalQueued,
    });
  await database`UPDATE participants SET last_seen=${Date.now()}, status=CASE WHEN status='waiting' THEN status ELSE 'online' END WHERE user_id=${session.id}`;
  const [participant] =
    await database`SELECT u.id, u.name, u.college, u.locked, u.disqualified, p.quiz_submitted_at::float8 AS "quizSubmittedAt", p.quiz_correct AS "quizCorrect", p.coins, p.coding_score AS "codingScore", p.language, p.current_question AS "currentQuestion", p.solved, p.helps_used AS "helpsUsed", p.completion_time::float8 AS "completionTime", p.coding_submitted_at::float8 AS "codingSubmittedAt", p.status, p.last_seen::float8 AS "lastSeen", p.security_violation_count AS "securityViolationCount", p.security_last_violation_at::float8 AS "securityLastViolationAt", p.security_last_violation_reason AS "securityLastViolationReason" FROM users u JOIN participants p ON p.user_id=u.id WHERE u.id=${session.id}`;
  const quiz =
    await database`SELECT id, category, difficulty, prompt, options_json AS options, coin_value AS "coinValue" FROM quiz_questions ORDER BY id`;
  const answers =
    await database`SELECT question_id AS "questionId", answer_index AS "answerIndex" FROM quiz_answers WHERE participant_id=${session.id}`;
  const problems =
    await database`SELECT id, title, difficulty, points, statement, input_format AS "inputFormat", output_format AS "outputFormat", sample_input AS "sampleInput", sample_output AS "sampleOutput" FROM coding_questions ORDER BY id`;
  const purchases =
    await database`SELECT id, question_id AS "questionId", kind, cost, content, created_at::float8 AS "createdAt" FROM help_purchases WHERE participant_id=${session.id} ORDER BY created_at`;
  const questionScores =
    await database`SELECT question_id AS "questionId", best_passed_count AS "bestPassedCount", total_tests AS "totalTests", points_awarded AS "pointsAwarded" FROM coding_question_scores WHERE participant_id=${session.id} ORDER BY question_id`;
  const [latestSubmission] =
    await database`SELECT j.id, j.question_id AS "questionId", j.status, COALESCE((j.result_json->>'passed')::int, s.passed_count) AS "passedCount", COALESCE((j.result_json->>'processed')::int, CASE WHEN j.status='completed' THEN (j.result_json->>'total')::int ELSE 0 END, 0) AS "processedTests", s.verdict, j.last_error AS "lastError", COALESCE((j.result_json->>'total')::int, (SELECT count(*)::int FROM test_cases WHERE question_id=j.question_id)) AS "totalTests", COALESCE((j.result_json->>'score')::int, 0) AS "pointsAwarded", EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt", s.completed_at::float8 AS "completedAt" FROM submission_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.participant_id=${session.id} AND j.mode='submit' ORDER BY j.created_at DESC LIMIT 1`;
  const [latestRun] =
    await database`SELECT j.id, j.question_id AS "questionId", j.status, j.last_error AS "lastError", COALESCE(j.result_json->>'stdout', '') AS stdout, COALESCE(j.result_json->>'stderr', '') AS stderr, COALESCE((j.result_json->>'exitCode')::int, 0) AS "exitCode", COALESCE((j.result_json->>'elapsedMs')::int, 0) AS "elapsedMs", COALESCE((j.result_json->>'timedOut')::boolean, false) AS "timedOut", COALESCE((j.result_json->>'samplePassed')::boolean, false) AS "samplePassed", COALESCE((j.result_json->>'executionOk')::boolean, false) AS "executionOk", COALESCE(j.result_json->>'expectedOutput', '') AS "expectedOutput", EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt" FROM submission_jobs j WHERE j.participant_id=${session.id} AND j.mode='run' ORDER BY j.created_at DESC LIMIT 1`;
  const [myQueueRow] = await database<{ position: number }[]>`
    SELECT (count(*) + 1)::int AS position FROM submission_jobs
    WHERE status='queued' AND created_at < (
      SELECT created_at FROM submission_jobs
      WHERE status='queued' AND participant_id=${session.id}
      ORDER BY created_at LIMIT 1
    )`;
  return json({
    session,
    participant,
    rounds: roundMap,
    leaderboard,
    questionCount,
    quiz,
    answers,
    problems,
    purchases,
    questionScores,
    latestSubmission: latestSubmission || null,
    latestRun: latestRun || null,
    serverTime: Date.now(),
    judgeConfigured: queueEnabled(),
    totalQueued,
    myQueuePosition: myQueueRow?.position ?? null,
  });
}

async function loadLeaderboard(database: ReturnType<typeof db>, trace: Trace) {
  return timed(trace, "snapshot.leaderboard", () =>
    database<Row[]>`SELECT u.id, u.name, u.college, p.coins, p.quiz_correct AS "quizCorrect", p.coding_score AS "codingScore", p.language, p.current_question AS "currentQuestion", p.solved, p.helps_used AS "helpsUsed", p.completion_time AS "completionTime", p.status, p.last_seen::float8 AS "lastSeen", p.security_violation_count AS "securityViolationCount", p.security_last_violation_at::float8 AS "securityLastViolationAt", p.security_last_violation_reason AS "securityLastViolationReason", u.locked, u.disqualified FROM participants p JOIN users u ON u.id=p.user_id ORDER BY p.solved DESC, p.coding_score DESC, p.helps_used ASC, COALESCE(p.completion_time, 9999999999999) ASC, u.id ASC`,
  );
}

async function loadRounds(database: ReturnType<typeof db>, trace: Trace) {
  const now = Date.now();
  if (roundsCache && roundsCache.expiresAt > now) return roundsCache.value;
  if (roundsCache) {
    if (!roundsLoad) {
      roundsLoad = timed(trace, "snapshot.rounds-refresh", () =>
        database<Row[]>`SELECT * FROM rounds ORDER BY id`,
      )
        .then((rows) => {
          roundsCache = {
            expiresAt: Date.now() + 3_000,
            value: rows,
          };
          return rows;
        })
        .catch((error) => {
          roundsCache = {
            expiresAt: Date.now() + 1_000,
            value: roundsCache!.value,
          };
          console.error(
            JSON.stringify({
              type: "api-error",
              action: "rounds-cache-refresh",
              error: error instanceof Error ? error.message : "Unknown error",
            }),
          );
          return roundsCache.value;
        })
        .finally(() => {
          roundsLoad = undefined;
        });
    }
    return roundsCache.value;
  }
  if (roundsLoad) return roundsLoad;
  roundsLoad = timed(trace, "snapshot.rounds", () =>
    database<Row[]>`SELECT * FROM rounds ORDER BY id`,
  ).then((rows) => {
    roundsCache = { expiresAt: Date.now() + 3_000, value: rows };
    return rows;
  }).finally(() => {
    roundsLoad = undefined;
  });
  return roundsLoad;
}


async function loadParticipantBundle(
  database: ReturnType<typeof db>,
  trace: Trace,
  participantId: string,
) {
  const [bundle] = await timed(trace, "snapshot.participant-bundle", () =>
    database<Row[]>`
      WITH touched AS (
        UPDATE participants
        SET last_seen=${Date.now()}, status=CASE WHEN status='waiting' THEN status ELSE 'online' END
        WHERE user_id=${participantId}
        RETURNING *
      )
      SELECT
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'college', u.college,
          'locked', u.locked,
          'disqualified', u.disqualified,
          'quizSubmittedAt', p.quiz_submitted_at,
          'quizCorrect', p.quiz_correct,
          'coins', p.coins,
          'codingScore', p.coding_score,
          'language', p.language,
          'currentQuestion', p.current_question,
          'solved', p.solved,
          'helpsUsed', p.helps_used,
          'completionTime', p.completion_time,
          'codingSubmittedAt', p.coding_submitted_at,
          'status', p.status,
          'lastSeen', p.last_seen,
          'securityViolationCount', p.security_violation_count,
          'securityLastViolationAt', p.security_last_violation_at,
          'securityLastViolationReason', p.security_last_violation_reason
        ) AS participant,
        (
          SELECT ranked.position
          FROM (
            SELECT user_id, row_number() OVER (
              ORDER BY solved DESC, coding_score DESC, helps_used ASC,
                COALESCE(completion_time, 9999999999999) ASC, user_id ASC
            )::int AS position
            FROM participants
          ) ranked
          WHERE ranked.user_id=${participantId}
        ) AS "participantRank",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'questionId', a.question_id,
            'answerIndex', a.answer_index
          ) ORDER BY a.question_id)
          FROM quiz_answers a
          WHERE a.participant_id=${participantId}
        ), '[]'::jsonb) AS answers,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', hp.id,
            'questionId', hp.question_id,
            'kind', hp.kind,
            'cost', hp.cost,
            'content', hp.content,
            'createdAt', hp.created_at
          ) ORDER BY hp.created_at)
          FROM help_purchases hp
          WHERE hp.participant_id=${participantId}
        ), '[]'::jsonb) AS purchases,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'questionId', cqs.question_id,
            'bestPassedCount', cqs.best_passed_count,
            'totalTests', cqs.total_tests,
            'pointsAwarded', cqs.points_awarded
          ) ORDER BY cqs.question_id)
          FROM coding_question_scores cqs
          WHERE cqs.participant_id=${participantId}
        ), '[]'::jsonb) AS "questionScores",
        (
          SELECT to_jsonb(latest_submission)
          FROM (
            SELECT j.id, j.question_id AS "questionId", j.status,
              COALESCE((j.result_json->>'passed')::int, s.passed_count) AS "passedCount",
              COALESCE((j.result_json->>'processed')::int, CASE WHEN j.status='completed' THEN (j.result_json->>'total')::int ELSE 0 END, 0) AS "processedTests",
              s.verdict, j.last_error AS "lastError",
              COALESCE((j.result_json->>'total')::int, (SELECT count(*)::int FROM test_cases WHERE question_id=j.question_id)) AS "totalTests",
              COALESCE((j.result_json->>'score')::int, 0) AS "pointsAwarded",
              EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt",
              s.completed_at::float8 AS "completedAt"
            FROM submission_jobs j
            JOIN submissions s ON s.id=j.submission_id
            WHERE j.participant_id=${participantId} AND j.mode='submit'
            ORDER BY j.created_at DESC
            LIMIT 1
          ) latest_submission
        ) AS "latestSubmission",
        (
          SELECT to_jsonb(latest_run)
          FROM (
            SELECT j.id, j.question_id AS "questionId", j.status,
              j.last_error AS "lastError",
              COALESCE(j.result_json->>'stdout', '') AS stdout,
              COALESCE(j.result_json->>'stderr', '') AS stderr,
              COALESCE((j.result_json->>'exitCode')::int, 0) AS "exitCode",
              COALESCE((j.result_json->>'elapsedMs')::int, 0) AS "elapsedMs",
              COALESCE((j.result_json->>'timedOut')::boolean, false) AS "timedOut",
              COALESCE((j.result_json->>'samplePassed')::boolean, false) AS "samplePassed",
              COALESCE((j.result_json->>'executionOk')::boolean, false) AS "executionOk",
              COALESCE(j.result_json->>'expectedOutput', '') AS "expectedOutput",
              EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt"
            FROM submission_jobs j
            WHERE j.participant_id=${participantId} AND j.mode='run'
            ORDER BY j.created_at DESC
            LIMIT 1
          ) latest_run
        ) AS "latestRun",
        (SELECT count(*)::int FROM submission_jobs WHERE status IN ('queued','running')) AS "totalQueued",
        (
          SELECT (count(*) + 1)::int
          FROM submission_jobs
          WHERE status='queued' AND created_at < (
            SELECT created_at FROM submission_jobs
            WHERE status='queued' AND participant_id=${participantId}
            ORDER BY created_at LIMIT 1
          )
        ) AS "myQueuePosition"
      FROM touched p
      JOIN users u ON u.id=p.user_id
    `,
  );
  return bundle;
}

async function loadParticipantLive(
  database: ReturnType<typeof db>,
  trace: Trace,
  participantId: string,
  includeJudgeState: boolean,
) {
  if (!includeJudgeState) {
    const [bundle] = await timed(trace, "snapshot.participant-live", () =>
      database<Row[]>`
        SELECT jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'college', u.college,
          'locked', u.locked,
          'disqualified', u.disqualified,
          'quizSubmittedAt', p.quiz_submitted_at,
          'quizCorrect', p.quiz_correct,
          'coins', p.coins,
          'codingScore', p.coding_score,
          'language', p.language,
          'currentQuestion', p.current_question,
          'solved', p.solved,
          'helpsUsed', p.helps_used,
          'completionTime', p.completion_time,
          'codingSubmittedAt', p.coding_submitted_at,
          'status', p.status,
          'lastSeen', p.last_seen,
          'securityViolationCount', p.security_violation_count,
          'securityLastViolationAt', p.security_last_violation_at,
          'securityLastViolationReason', p.security_last_violation_reason
        ) AS participant,
        (
          SELECT ranked.position
          FROM (
            SELECT user_id, row_number() OVER (
              ORDER BY solved DESC, coding_score DESC, helps_used ASC,
                COALESCE(completion_time, 9999999999999) ASC, user_id ASC
            )::int AS position
            FROM participants
          ) ranked
          WHERE ranked.user_id=${participantId}
        ) AS "participantRank"
        FROM participants p
        JOIN users u ON u.id=p.user_id
        WHERE p.user_id=${participantId}
      `,
    );
    if (bundle?.participant) {
      const participant = bundle.participant as Row;
      userRoleCache.set(participantId, {
        expiresAt: Date.now() + 30_000,
        role: "participant",
        locked: Boolean(participant.locked),
        disqualified: Boolean(participant.disqualified),
      });
    }
    return {
      ...bundle,
      questionScores: [],
      latestSubmission: null,
      latestRun: null,
    };
  }

  const [bundle] = await timed(trace, "snapshot.participant-live", () =>
    database<Row[]>`
      SELECT
        jsonb_build_object(
          'id', u.id,
          'name', u.name,
          'college', u.college,
          'locked', u.locked,
          'disqualified', u.disqualified,
          'quizSubmittedAt', p.quiz_submitted_at,
          'quizCorrect', p.quiz_correct,
          'coins', p.coins,
          'codingScore', p.coding_score,
          'language', p.language,
          'currentQuestion', p.current_question,
          'solved', p.solved,
          'helpsUsed', p.helps_used,
          'completionTime', p.completion_time,
          'codingSubmittedAt', p.coding_submitted_at,
          'status', p.status,
          'lastSeen', p.last_seen,
          'securityViolationCount', p.security_violation_count,
          'securityLastViolationAt', p.security_last_violation_at,
          'securityLastViolationReason', p.security_last_violation_reason
        ) AS participant,
        (
          SELECT ranked.position
          FROM (
            SELECT user_id, row_number() OVER (
              ORDER BY solved DESC, coding_score DESC, helps_used ASC,
                COALESCE(completion_time, 9999999999999) ASC, user_id ASC
            )::int AS position
            FROM participants
          ) ranked
          WHERE ranked.user_id=${participantId}
        ) AS "participantRank",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'questionId', cqs.question_id,
            'bestPassedCount', cqs.best_passed_count,
            'totalTests', cqs.total_tests,
            'pointsAwarded', cqs.points_awarded
          ) ORDER BY cqs.question_id)
          FROM coding_question_scores cqs
          WHERE cqs.participant_id=${participantId}
        ), '[]'::jsonb) AS "questionScores",
        (
          SELECT to_jsonb(latest_submission)
          FROM (
            SELECT j.id, j.question_id AS "questionId", j.status,
              COALESCE((j.result_json->>'passed')::int, s.passed_count) AS "passedCount",
              COALESCE((j.result_json->>'processed')::int, 0) AS "processedTests",
              s.verdict, j.last_error AS "lastError",
              COALESCE((j.result_json->>'total')::int, 0) AS "totalTests",
              COALESCE((j.result_json->>'score')::int, 0) AS "pointsAwarded",
              EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt",
              s.completed_at::float8 AS "completedAt"
            FROM submission_jobs j
            JOIN submissions s ON s.id=j.submission_id
            WHERE j.participant_id=${participantId} AND j.mode='submit'
            ORDER BY j.created_at DESC
            LIMIT 1
          ) latest_submission
        ) AS "latestSubmission",
        (
          SELECT to_jsonb(latest_run)
          FROM (
            SELECT j.id, j.question_id AS "questionId", j.status,
              j.last_error AS "lastError",
              COALESCE(j.result_json->>'stdout', '') AS stdout,
              COALESCE(j.result_json->>'stderr', '') AS stderr,
              COALESCE((j.result_json->>'exitCode')::int, 0) AS "exitCode",
              COALESCE((j.result_json->>'elapsedMs')::int, 0) AS "elapsedMs",
              COALESCE((j.result_json->>'timedOut')::boolean, false) AS "timedOut",
              COALESCE((j.result_json->>'samplePassed')::boolean, false) AS "samplePassed",
              COALESCE((j.result_json->>'executionOk')::boolean, false) AS "executionOk",
              COALESCE(j.result_json->>'expectedOutput', '') AS "expectedOutput",
              EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt"
            FROM submission_jobs j
            WHERE j.participant_id=${participantId} AND j.mode='run'
            ORDER BY j.created_at DESC
            LIMIT 1
          ) latest_run
        ) AS "latestRun"
      FROM participants p
      JOIN users u ON u.id=p.user_id
      WHERE p.user_id=${participantId}
    `,
  );
  if (bundle?.participant) {
    const participant = bundle.participant as Row;
    userRoleCache.set(participantId, {
      expiresAt: Date.now() + 30_000,
      role: "participant",
      locked: Boolean(participant.locked),
      disqualified: Boolean(participant.disqualified),
    });
  }
  return bundle;
}

async function snapshot(
  request: Request,
  liveOnly = false,
  sharedOnly = false,
) {
  if (process.env.SNAPSHOT_LEGACY === "true") return legacySnapshot(request);
  const trace = createTrace(liveOnly ? "live-snapshot" : "snapshot");
  let status = 200;
  try {
    const session = await readSession(request);
    if (!session) {
      status = 401;
      return json({ error: "Authentication required" }, status);
    }
    const database = db();
    const roundsPromise = loadRounds(database, trace);
    if (session.role === "host") {
      const [rounds, leaderboard, shared, queue] = await Promise.all([
        roundsPromise,
        loadLeaderboard(database, trace),
        liveOnly
          ? Promise.resolve<SharedEventData | null>(null)
          : sharedEventData(database, trace),
        timed(trace, "snapshot.queue", () =>
          database<{ totalQueued: number }[]>`SELECT count(*)::int AS "totalQueued" FROM submission_jobs WHERE status IN ('queued','running')`,
        ),
      ]);
      return json({
        session,
        rounds: formatRounds(rounds),
        leaderboard,
        ...(shared || {}),
        serverTime: Date.now(),
        judgeConfigured: queueEnabled(),
        totalQueued: queue[0]?.totalQueued || 0,
      });
    }

    // Frequent participant timer/event polls only need public round state. The
    // signed HttpOnly session still authenticates this response, but avoiding a
    // participant query here keeps 200 idle browsers from continuously reading
    // private rows. Private state is fetched separately and is never cached.
    if (sharedOnly) {
      const rounds = await roundsPromise;
      return json({
        session,
        rounds: formatRounds(rounds),
        serverTime: Date.now(),
        judgeConfigured: queueEnabled(),
      });
    }

    const rounds = await roundsPromise;
    const codingRoundActive = rounds.some(
      (row: Row) => row.id === "round2" && row.status === "active",
    );
    const [bundle, shared] = await Promise.all([
      liveOnly
        ? loadParticipantLive(database, trace, session.id, codingRoundActive)
        : loadParticipantBundle(database, trace, session.id),
      liveOnly
        ? Promise.resolve<SharedEventData | null>(null)
        : sharedEventData(database, trace),
    ]);
    if (!bundle) {
      status = 404;
      return json({ error: "Participant not found" }, status);
    }
    return json({
      session,
      participant: bundle.participant,
      rounds: formatRounds(rounds),
      leaderboard: [],
      participantRank: Number(bundle.participantRank || 0),
      ...(shared || {}),
      answers: liveOnly ? undefined : bundle.answers,
      purchases: liveOnly ? undefined : bundle.purchases,
      questionScores: bundle.questionScores,
      latestSubmission: bundle.latestSubmission || null,
      latestRun: bundle.latestRun || null,
      serverTime: Date.now(),
      judgeConfigured: queueEnabled(),
      totalQueued: Number(bundle.totalQueued || 0),
      myQueuePosition: bundle.myQueuePosition
        ? Number(bundle.myQueuePosition)
        : null,
    });
  } catch (error) {
    status = 500;
    throw error;
  } finally {
    finishTrace(trace, status);
  }
}

async function requireRole(request: Request, role?: "host" | "participant") {
  const session = await readSession(request);
  if (!session || (role && session.role !== role)) return null;
  const cached = userRoleCache.get(session.id);
  const now = Date.now();
  let userRole: string, locked: boolean, disqualified: boolean;
  if (cached && cached.expiresAt > now) {
    ({ role: userRole, locked, disqualified } = cached);
  } else {
    const [user] = await db()`SELECT role, locked, disqualified FROM users WHERE id=${session.id}`;
    if (!user) return null;
    userRole = String(user.role);
    locked = Boolean(user.locked);
    disqualified = Boolean(user.disqualified);
    userRoleCache.set(session.id, { expiresAt: now + 30_000, role: userRole, locked, disqualified });
  }
  return userRole === session.role && !locked && !disqualified ? session : null;
}
async function login(request: Request, body: Body) {
  await ensureSeeded();
  const loginName = String(body.id || "").trim();
  const role = body.role === "host" ? "host" : "participant";
  const validLogin =
    role === "host"
      ? /^HOST-\d{2}$/i.test(loginName)
      : loginName.length >= 2 && loginName.length <= 80;
  if (!validLogin || String(body.password || "").length > 256)
    return json({ error: "Invalid credentials or account unavailable" }, 401);
  const normalizedLogin = role === "host" ? loginName.toUpperCase() : loginName;
  const key = await loginClientKey(request, normalizedLogin);
  const database = db();
  const [limit] =
    await database`SELECT blocked_until FROM login_rate_limits WHERE client_key=${key}`;
  const blockedUntil = Number(limit?.blocked_until || 0);
  if (blockedUntil > Date.now())
    return json(
      {
        error: `Too many failed attempts. Try again in ${Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60_000))} minutes.`,
      },
      429,
    );
  if (limit?.blocked_until)
    await database`DELETE FROM login_rate_limits WHERE client_key=${key}`;
  const [user] =
    role === "host"
      ? await database`SELECT id, role, password_hash, password_salt, locked, disqualified FROM users WHERE id=${normalizedLogin} AND role='host'`
      : await database`SELECT id, role, password_hash, password_salt, locked, disqualified FROM users WHERE name=${loginName} AND role='participant'`;
  const password = String(body.password || "");
  const expectedHash = user
    ? await hashPassword(password, String(user.password_salt))
    : "";
  const valid = user && safeEqual(expectedHash, String(user.password_hash));
  if (!valid || !user || user.locked || user.disqualified) {
    if (user) await recordLoginFailure(key);
    return json({ error: "Invalid credentials or account unavailable" }, 401);
  }
  // A valid login starts a fresh rate-limit window. Without this cleanup,
  // earlier typing mistakes remain attached to the host even after a
  // successful sign-in and can cause an unexpected later lockout.
  await database`DELETE FROM login_rate_limits WHERE client_key=${key}`;
  if (role === "participant") {
    await database`INSERT INTO participants (user_id, last_seen) VALUES (${user.id}, ${Date.now()}) ON CONFLICT DO NOTHING`;
  }
  const token = await createSession(String(user.id), role);
  const headers = new Headers(request.headers);
  headers.set("cookie", `ca_session=${token}`);
  const response = await snapshot(new Request(request.url, { headers }));
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Set-Cookie", sessionCookie(token, request));
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

async function hostAction(request: Request, body: Body) {
  if (!(await requireRole(request, "host")))
    return json({ error: "Host authorization required" }, 403);
  const database = db(),
    id = String(body.round || "round2"),
    action = String(body.control || ""),
    now = Date.now();
  if (id !== "round1" && id !== "round2")
    return json({ error: "Invalid round" }, 400);
  const [round] = await database`SELECT * FROM rounds WHERE id=${id}`;
  if (!round) return json({ error: "Round not found" }, 404);
  if (action === "start")
    await database.begin(async (tx) => {
      const restartingEvent =
        id === "round1" &&
        (round.status !== "waiting" || Boolean(round.started_at));
      if (restartingEvent) {
        await tx`DELETE FROM submissions`;
        await tx`DELETE FROM quiz_answers`;
        await tx`DELETE FROM solved_problems`;
        await tx`DELETE FROM coding_question_scores`;
        await tx`DELETE FROM help_purchases`;
        await tx`DELETE FROM coin_transactions`;
        await tx`DELETE FROM score_adjustments`;
        await tx`UPDATE participants SET quiz_submitted_at=NULL, quiz_correct=0, coins=0, coding_score=0, language=NULL, current_question=1, solved=0, helps_used=0, completion_time=NULL, coding_submitted_at=NULL, status='waiting', last_seen=${now}`;
        await tx`UPDATE rounds SET status='waiting', started_at=NULL, paused_at=NULL, accumulated_pause_seconds=0, results_published=false, updated_at=${now}`;
      }
      await tx`UPDATE rounds SET status='ended', paused_at=NULL, updated_at=${now} WHERE id<>${id} AND status IN ('active','paused')`;
      await tx`UPDATE rounds SET status='active', started_at=${now}, paused_at=NULL, accumulated_pause_seconds=0, results_published=false, updated_at=${now} WHERE id=${id}`;
    });
  else if (action === "pause" && round.status === "active")
    await database`UPDATE rounds SET status='paused', paused_at=${now}, updated_at=${now} WHERE id=${id}`;
  else if (action === "resume" && round.status === "paused")
    await database`UPDATE rounds SET status='active', accumulated_pause_seconds=accumulated_pause_seconds+((${now}-paused_at)/1000)::int, paused_at=NULL, updated_at=${now} WHERE id=${id}`;
  else if (
    action === "add" &&
    (round.status === "active" || round.status === "paused")
  )
    await database`UPDATE rounds SET duration_seconds=duration_seconds+${Math.min(1800, Math.max(0, Number(body.seconds || 0)))}, updated_at=${now} WHERE id=${id}`;
  else if (action === "end" && round.status !== "ended")
    await database`UPDATE rounds SET status='ended', updated_at=${now} WHERE id=${id}`;
  else if (action === "end" && round.status === "ended") {
    /* idempotent */
  } else if (
    action === "publish" &&
    id === "round2" &&
    round.status === "ended"
  )
    await database`UPDATE rounds SET results_published=true, updated_at=${now} WHERE id='round2'`;
  else
    return json(
      {
        error:
          action === "pause"
            ? "Only an active round can be paused"
            : action === "resume"
              ? "Only a paused round can be resumed"
              : action === "add"
                ? "Start the round before adding time"
                : action === "publish"
                  ? "End Round 2 before publishing results"
                  : "Invalid round control",
      },
      400,
    );
  return snapshot(request);
}

async function participantControl(request: Request, body: Body) {
  if (!(await requireRole(request, "host")))
    return json({ error: "Host authorization required" }, 403);
  const target = String(body.participantId || ""),
    control = String(body.control || ""),
    database = db();
  if (!/^CA-\d{4}$/.test(target))
    return json({ error: "Invalid participant" }, 400);
  if (control === "lock")
    await database`UPDATE users SET locked=true WHERE id=${target} AND role='participant'`;
  else if (control === "unlock")
    await database`UPDATE users SET locked=false WHERE id=${target} AND role='participant'`;
  else if (control === "disqualify")
    await database.begin(async (tx) => {
      await tx`UPDATE users SET disqualified=true, locked=true WHERE id=${target}`;
      await tx`UPDATE participants SET status='disqualified' WHERE user_id=${target}`;
    });
  else if (control === "reinstate")
    await database.begin(async (tx) => {
      await tx`UPDATE users SET disqualified=false, locked=false WHERE id=${target}`;
      await tx`UPDATE participants SET status='waiting', security_violation_count=0, security_last_violation_at=NULL, security_last_violation_reason=NULL, security_disqualified_at=NULL WHERE user_id=${target}`;
      await tx`DELETE FROM exam_violations WHERE participant_id=${target}`;
    });
  else if (control === "remove") {
    const removed =
      await database`DELETE FROM users WHERE id=${target} AND role='participant' RETURNING id`;
    if (!removed.length) return json({ error: "Participant not found" }, 404);
  } else return json({ error: "Invalid participant control" }, 400);
  userRoleCache.delete(target);
  return snapshot(request);
}

const securityReasons = new Set([
  "tab-hidden",
  "window-focus-lost",
  "fullscreen-exit",
  "copy-attempt",
  "cut-attempt",
  "paste-attempt",
  "select-all-attempt",
  "blocked-browser-shortcut",
  "context-menu-attempt",
]);

async function recordSecurityViolation(request: Request, body: Body) {
  const session = await readSession(request);
  if (!session || session.role !== "participant")
    return json({ error: "Participant authorization required" }, 403);
  const reason = String(body.reason || "");
  const roundId = body.round === "round1" ? "round1" : "round2";
  const clientEventId = String(body.eventId || "");
  if (!securityReasons.has(reason) || !/^[a-zA-Z0-9-]{16,80}$/.test(clientEventId))
    return json({ error: "Invalid security event" }, 400);

  const database = db();
  const now = Date.now();
  let notice: Row = {};
  await database.begin(async (tx) => {
    const [round] = await tx<Row[]>`SELECT * FROM rounds WHERE id=${roundId}`;
    if (
      !round ||
      round.status !== "active" ||
      remaining({
        status: String(round.status),
        duration_seconds: Number(round.duration_seconds),
        started_at: Number(round.started_at),
        paused_at: round.paused_at ? Number(round.paused_at) : null,
        accumulated_pause_seconds: Number(round.accumulated_pause_seconds),
      }) <= 0
    )
      throw new Error("Exam security is not active");
    const [user] =
      await tx`SELECT u.locked, u.disqualified, p.security_violation_count, p.security_last_violation_at FROM users u JOIN participants p ON p.user_id=u.id WHERE u.id=${session.id} AND u.role='participant' FOR UPDATE OF u, p`;
    if (!user) throw new Error("Participant not found");

    const [duplicate] =
      await tx`SELECT id FROM exam_violations WHERE client_event_id=${clientEventId}`;
    const currentCount = Number(user.security_violation_count || 0);
    if (duplicate || user.disqualified) {
      notice = {
        violationCount: currentCount,
        warningsRemaining: Math.max(0, 3 - currentCount),
        disqualified: Boolean(user.disqualified),
        reason,
        timestamp: now,
        deduplicated: true,
      };
      return;
    }

    const lastAt = user.security_last_violation_at
      ? Number(user.security_last_violation_at)
      : 0;
    if (lastAt && now - lastAt < 2500) {
      notice = {
        violationCount: currentCount,
        warningsRemaining: Math.max(0, 3 - currentCount),
        disqualified: false,
        reason,
        timestamp: now,
        deduplicated: true,
      };
      return;
    }

    const nextCount = Math.min(3, currentCount + 1);
    const disqualified = nextCount >= 3;
    await tx`INSERT INTO exam_violations (client_event_id, participant_id, round_id, reason, occurred_at) VALUES (${clientEventId}, ${session.id}, ${roundId}, ${reason}, ${now})`;
    await tx`UPDATE participants SET security_violation_count=${nextCount}, security_last_violation_at=${now}, security_last_violation_reason=${reason}, security_disqualified_at=${disqualified ? now : null}, status=${disqualified ? "disqualified" : "online"} WHERE user_id=${session.id}`;
    if (disqualified)
      await tx`UPDATE users SET disqualified=true, locked=true WHERE id=${session.id}`;
    notice = {
      violationCount: nextCount,
      warningsRemaining: Math.max(0, 3 - nextCount),
      disqualified,
      reason,
      timestamp: now,
      deduplicated: false,
    };
  });

  if (notice.disqualified) userRoleCache.delete(session.id);
  const state = await (await snapshot(request)).json();
  return json({ ...state, securityNotice: notice });
}

async function addTeams(request: Request, body: Body) {
  if (!(await requireRole(request, "host")))
    return json({ error: "Host authorization required" }, 403);
  const supplied = Array.isArray(body.teams) ? body.teams : [];
  const names = [
    ...new Map(
      supplied
        .map((v) => String(v).trim())
        .filter(Boolean)
        .map((n) => [n.toLocaleLowerCase(), n]),
    ).values(),
  ];
  if (!names.length || names.length > 200)
    return json({ error: "Enter between 1 and 200 team names" }, 400);
  if (names.some((n) => n.length < 2 || n.length > 80))
    return json(
      { error: "Every team name must contain between 2 and 80 characters" },
      400,
    );
  const database = db();
  const created: { id: string; name: string; password: string }[] = [];
  await database.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('code-auction-team-create'))`;
    const existing = await tx<
      { id: string; name: string }[]
    >`SELECT id, name FROM users WHERE role='participant'`;
    const existingNames = new Set(
      existing.map((r) => r.name.toLocaleLowerCase()),
    );
    const usedIds = new Set(existing.map((r) => Number(r.id.slice(3))));
    let candidate = 1001;
    for (const name of names) {
      if (existingNames.has(name.toLocaleLowerCase())) continue;
      while (usedIds.has(candidate) && candidate <= 9999) candidate++;
      if (candidate > 9999) throw new Error("No participant IDs are available");
      const id = `CA-${candidate}`;
      const salt = randomSalt();
      const hash = await hashPassword(name, salt);
      const now = Date.now();
      await tx`INSERT INTO users (id, role, name, college, password_hash, password_salt, created_at) VALUES (${id}, 'participant', ${name}, 'Team', ${hash}, ${salt}, ${now})`;
      await tx`INSERT INTO participants (user_id, last_seen) VALUES (${id}, ${now})`;
      created.push({ id, name, password: name });
      existingNames.add(name.toLocaleLowerCase());
      usedIds.add(candidate++);
    }
  });
  if (!created.length)
    return json({ error: "Those team names already exist" }, 409);
  return json({ created, state: await (await snapshot(request)).json() }, 201);
}

async function removeAllTeams(request: Request) {
  if (!(await requireRole(request, "host")))
    return json({ error: "Host authorization required" }, 403);
  const removed =
    await db()`DELETE FROM users WHERE role='participant' RETURNING id`;
  return json({
    removed: removed.length,
    state: await (await snapshot(request)).json(),
  });
}
type CodingQuestionInput = Record<string, unknown>;
function validateCodingQuestion(value: CodingQuestionInput) {
  const title = String(value.title || "").trim();
  const difficulty = String(value.difficulty || "").toUpperCase();
  const points = Number(value.points);
  const statement = String(value.statement || "").trim();
  const inputFormat = String(value.inputFormat || "").trim();
  const outputFormat = String(value.outputFormat || "").trim();
  const sampleInput = String(value.sampleInput ?? "");
  const sampleOutput = String(value.sampleOutput ?? "");
  const hints = Array.isArray(value.hints)
    ? value.hints
        .map(String)
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, 10)
    : [];
  const tests = Array.isArray(value.tests)
    ? value.tests.map((t) =>
        Array.isArray(t)
          ? [String(t[0] ?? ""), String(t[1] ?? "")]
          : [
              String((t as Row)?.input ?? ""),
              String((t as Row)?.expectedOutput ?? ""),
            ],
      )
    : [];
  if (
    title.length < 3 ||
    title.length > 120 ||
    statement.length < 10 ||
    statement.length > 5000
  )
    throw new Error("Each question needs a title and a complete statement");
  if (
    !["EASY", "MEDIUM", "HARD"].includes(difficulty) ||
    !Number.isInteger(points) ||
    points < 1 ||
    points > 10000
  )
    throw new Error("Question difficulty or points are invalid");
  if (!inputFormat || !outputFormat || tests.length < 1 || tests.length > 20)
    throw new Error(
      "Each question needs input/output formats and 1 to 20 test cases",
    );
  if (tests.some((t) => t[0].length > 10000 || t[1].length > 10000))
    throw new Error("A test case is too large");
  return {
    title,
    difficulty,
    points,
    statement,
    inputFormat,
    outputFormat,
    sampleInput,
    sampleOutput,
    hints,
    tests,
  };
}

async function addQuestions(request: Request, body: Body) {
  if (!(await requireRole(request, "host")))
    return json({ error: "Host authorization required" }, 403);
  const supplied = Array.isArray(body.questions) ? body.questions : [];
  if (!supplied.length || supplied.length > 50)
    return json({ error: "Add between 1 and 50 questions at a time" }, 400);
  const questions = supplied.map((v) =>
    validateCodingQuestion(v as CodingQuestionInput),
  );
  const database = db();
  const ids: number[] = [];
  await database.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('code-auction-question-create'))`;
    const [{ nextId, oldCount }] = await tx<
      { nextId: number; oldCount: number }[]
    >`SELECT COALESCE(max(id), 0)::int + 1 AS "nextId", count(*)::int AS "oldCount" FROM coding_questions`;
    for (const [offset, question] of questions.entries()) {
      const id = nextId + offset;
      await tx`INSERT INTO coding_questions (id, title, difficulty, points, statement, input_format, output_format, sample_input, sample_output, hints_json) VALUES (${id}, ${question.title}, ${question.difficulty}, ${question.points}, ${question.statement}, ${question.inputFormat}, ${question.outputFormat}, ${question.sampleInput}, ${question.sampleOutput}, ${tx.json(question.hints)})`;
      for (const [position, test] of question.tests.entries())
        await tx`INSERT INTO test_cases (question_id, input, expected_output, position) VALUES (${id}, ${test[0]}, ${test[1]}, ${position + 1})`;
      ids.push(id);
    }
    await tx`UPDATE participants SET current_question=${nextId}, completion_time=NULL WHERE completion_time IS NOT NULL OR solved >= ${oldCount}`;
  });
  invalidateSharedEventCache();
  return json(
    { createdQuestionIds: ids, state: await (await snapshot(request)).json() },
    201,
  );
}

async function manualScore(request: Request, body: Body) {
  const session = await requireRole(request, "host");
  if (!session) return json({ error: "Host authorization required" }, 403);
  const target = String(body.participantId || ""),
    delta = Number(body.delta),
    reason = String(body.reason || "").trim(),
    database = db();
  if (
    !/^CA-\d{4}$/.test(target) ||
    !Number.isInteger(delta) ||
    delta === 0 ||
    Math.abs(delta) > 5000
  )
    return json({ error: "Invalid score adjustment" }, 400);
  if (reason.length < 5 || reason.length > 200)
    return json(
      { error: "Provide a reason between 5 and 200 characters" },
      400,
    );
  await database.begin(async (tx) => {
    const [p] =
      await tx`SELECT coding_score FROM participants WHERE user_id=${target} FOR UPDATE`;
    if (!p) throw new Error("Participant not found");
    const before = Number(p.coding_score),
      after = Math.max(0, before + delta);
    await tx`UPDATE participants SET coding_score=${after} WHERE user_id=${target}`;
    await tx`INSERT INTO score_adjustments (participant_id, host_id, delta, reason, score_before, score_after, created_at) VALUES (${target}, ${session.id}, ${after - before}, ${reason}, ${before}, ${after}, ${Date.now()})`;
  });
  return snapshot(request);
}

async function answerQuestion(request: Request, body: Body) {
  const trace = createTrace("answer");
  let status = 200;
  try {
    const session = await timed(trace, "answer.authorization", () =>
      requireRole(request, "participant"),
    );
    if (!session) {
      status = 403;
      return json({ error: "Participant authorization required" }, status);
    }
    const questionId = Number(body.questionId),
      answerIndex = Number(body.answerIndex),
      database = db();
    if (
      !Number.isInteger(questionId) ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > 3
    ) {
      status = 400;
      return json({ error: "Invalid answer" }, status);
    }
    const rounds = await loadRounds(database, trace);
    const round = rounds.find((row: Row) => row.id === "round1");
    if (
      !round ||
      round.status !== "active" ||
      remaining({
        status: String(round.status),
        duration_seconds: Number(round.duration_seconds),
        started_at: Number(round.started_at),
        paused_at: round.paused_at ? Number(round.paused_at) : null,
        accumulated_pause_seconds: Number(round.accumulated_pause_seconds),
      }) <= 0
    ) {
      status = 409;
      return json({ error: "Quiz is not active" }, status);
    }
    await timed(trace, "answer.upsert", () =>
      database`INSERT INTO quiz_answers (participant_id, question_id, answer_index, answered_at) VALUES (${session.id}, ${questionId}, ${answerIndex}, ${Date.now()}) ON CONFLICT (participant_id, question_id) DO UPDATE SET answer_index=excluded.answer_index, answered_at=excluded.answered_at`,
    );
    return json({ ok: true });
  } finally {
    finishTrace(trace, status);
  }
}

async function submitQuiz(request: Request) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  const database = db();
  await database.begin(async (tx) => {
    const [p] =
      await tx`SELECT quiz_submitted_at FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    if (p?.quiz_submitted_at) return;
    const [result] =
      await tx`SELECT count(*)::int AS correct, COALESCE(sum(q.coin_value),0)::int AS coins FROM quiz_answers a JOIN quiz_questions q ON q.id=a.question_id WHERE a.participant_id=${session.id} AND a.answer_index=q.correct_index`;
    const coins = Number(result.coins),
      now = Date.now();
    await tx`UPDATE participants SET quiz_submitted_at=${now}, quiz_correct=${Number(result.correct)}, coins=${coins}, status='waiting' WHERE user_id=${session.id}`;
    await tx`INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) VALUES (${session.id}, 'quiz_award', 'Round 1 quiz earnings', 0, ${coins}, ${coins}, ${now})`;
  });
  return snapshot(request);
}

async function selectLanguage(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  const language =
    body.language === "Python" || body.language === "Java"
      ? body.language
      : null;
  if (!language) return json({ error: "Unsupported language" }, 400);
  const [round] = await db()`SELECT status FROM rounds WHERE id='round2'`;
  if (round?.status !== "active")
    return json({ error: "Round 2 is not active" }, 409);
  const updated =
    await db()`UPDATE participants SET language=${language}, status='coding' WHERE user_id=${session.id} AND language IS NULL RETURNING user_id`;
  if (!updated.length)
    return json({ error: "Language is already locked" }, 409);
  return snapshot(request);
}
const helpCosts: Record<string, number> = {
  small: 200,
  algorithm: 300,
  pseudocode: 450,
  reveal: 650,
  ai: 800,
};

function buildHelpContent(
  kind: string,
  hints: string[],
  title: string,
  language: string,
): string {
  const h0 = hints[0] || "Break the problem into smaller steps.";
  const h1 =
    hints[1] || "Think about the most efficient data structure for this task.";
  const h2 =
    hints[2] ||
    "Consider how you would solve this manually, then code that process.";
  const pyTemplate =
    "# Read input:\n# line = input()  # or sys.stdin.readline()\n# Process according to the steps above.\n# print(answer)";
  const javaTemplate =
    "// Read input:\n// Scanner sc = new Scanner(System.in);\n// Process according to steps above.\n// System.out.println(answer);";
  if (kind === "small") return `SMALL HINT — "${title}"\n\n${h0}`;
  if (kind === "algorithm")
    return `ALGORITHM HINT — "${title}"\n\n${h1}\n\n${h2}`;
  if (kind === "pseudocode")
    return `PSEUDOCODE — "${title}" (${language})\n\n${h2}\n\nStep-by-step:\n  1. Read the input as described.\n  2. ${h0}\n  3. ${h1}\n  4. Output the result in the required format.\n\nBonus hint: ${hints[3] || h0}`;
  if (kind === "reveal")
    return `50% REVEAL — "${title}" (${language})\n\nSolution breakdown:\n  Step 1: ${h0}\n  Step 2: ${h1}\n  Step 3: ${h2}\n\nCode template:\n${language === "Python" ? pyTemplate : javaTemplate}`;
  if (kind === "ai")
    return `AI ASSISTANCE — "${title}" (${language})\n\nMessage 1 — Understand the problem:\n  ${hints.join(" → ") || h0}\n\nMessage 2 — Strategy:\n  ${h2}\n  Edge cases to consider: empty input, all same values, large numbers.\n\nMessage 3 — ${language} starter template:\n${language === "Python" ? `  import sys\n  def solve():\n      # ${h0}\n      pass\n  solve()` : `  import java.util.*;\n  public class Main {\n    public static void main(String[] args) {\n      Scanner sc = new Scanner(System.in);\n      // ${h0}\n    }\n  }`}`;
  return hints.join("\n");
}

async function purchaseHelp(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  const kind = String(body.kind || ""),
    cost = helpCosts[kind],
    questionId = Number(body.questionId);
  if (!cost) return json({ error: "Invalid help type" }, 400);
  if (!Number.isInteger(questionId))
    return json({ error: "Invalid coding question" }, 400);
  const database = db();
  await database.begin(async (tx) => {
    const [p] =
      await tx`SELECT * FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    if (!p?.language || Number(p.helps_used) >= 3 || Number(p.coins) < cost)
      throw new Error("Purchase limit or balance check failed");
    const [q] =
      await tx`SELECT id, title, hints_json FROM coding_questions WHERE id=${questionId}`;
    if (!q) throw new Error("Coding question not found");
    const [existing] =
      await tx`SELECT id FROM help_purchases WHERE participant_id=${session.id} AND question_id=${questionId} AND kind=${kind}`;
    if (existing)
      throw new Error("You already purchased this help for this question");
    const hints = (q.hints_json as string[]) || [];
    const content = buildHelpContent(
      kind,
      hints,
      String(q.title),
      String(p.language),
    );
    const before = Number(p.coins),
      after = before - cost,
      now = Date.now();
    await tx`UPDATE participants SET coins=${after}, helps_used=helps_used+1 WHERE user_id=${session.id}`;
    await tx`INSERT INTO help_purchases (participant_id, question_id, kind, cost, language, content, created_at) VALUES (${session.id}, ${q.id}, ${kind}, ${cost}, ${p.language}, ${content}, ${now})`;
    await tx`INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) VALUES (${session.id}, 'help_purchase', ${kind + " for Q" + questionId}, ${before}, ${-cost}, ${after}, ${now})`;
  });
  return snapshot(request);
}

async function runSample(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  if (!queueEnabled()) return json({ error: "Judge is disabled" }, 503);
  const source = String(body.source || ""),
    questionId = Number(body.questionId);
  if (!source || source.length > 50000)
    return json(
      { error: "Source must be between 1 and 50,000 characters" },
      400,
    );
  if (!Number.isInteger(questionId))
    return json({ error: "Invalid question" }, 400);
  const database = db();
  let submissionId: unknown;
  await database.begin(async (tx) => {
    const [p] =
      await tx`SELECT * FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    const [round] = await tx<Row[]>`SELECT * FROM rounds WHERE id='round2'`;
    if (
      !p?.language ||
      p.coding_submitted_at ||
      !round ||
      round.status !== "active" ||
      remaining({
        status: String(round.status),
        duration_seconds: Number(round.duration_seconds),
        started_at: Number(round.started_at),
        paused_at: round.paused_at ? Number(round.paused_at) : null,
        accumulated_pause_seconds: Number(round.accumulated_pause_seconds),
      }) <= 0
    )
      throw new Error("Submissions are currently locked");
    const [question] =
      await tx`SELECT id FROM coding_questions WHERE id=${questionId}`;
    if (!question) throw new Error("Coding question not found");
    const active =
      await tx`SELECT id FROM submission_jobs WHERE participant_id=${session.id} AND status IN ('queued','running') LIMIT 1`;
    if (active.length)
      throw new Error("A submission is already queued or running");
    const [submission] =
      await tx`INSERT INTO submissions (participant_id, question_id, language, source, verdict, created_at) VALUES (${session.id}, ${questionId}, ${p.language}, ${source}, 'queued', ${Date.now()}) RETURNING id`;
    submissionId = submission.id;
    await tx`INSERT INTO submission_jobs (submission_id, participant_id, question_id, language, source, mode) VALUES (${submission.id}, ${session.id}, ${questionId}, ${p.language}, ${source}, 'run')`;
  });
  return json(
    {
      queued: true,
      submissionId: String(submissionId),
      state: await (await snapshot(request)).json(),
    },
    202,
  );
}

async function submitCode(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  if (!queueEnabled()) return json({ error: "Judge queue is disabled" }, 503);
  const source = String(body.source || ""),
    questionId = Number(body.questionId);
  if (!source || source.length > 50000)
    return json(
      { error: "Source must be between 1 and 50,000 characters" },
      400,
    );
  if (!Number.isInteger(questionId))
    return json({ error: "Invalid coding question" }, 400);
  const database = db();
  let submissionId: unknown;
  await database.begin(async (tx) => {
    const [p] =
      await tx`SELECT * FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    const [round] = await tx<Row[]>`SELECT * FROM rounds WHERE id='round2'`;
    if (
      !p?.language ||
      p.coding_submitted_at ||
      !round ||
      round.status !== "active" ||
      remaining({
        status: String(round.status),
        duration_seconds: Number(round.duration_seconds),
        started_at: Number(round.started_at),
        paused_at: round.paused_at ? Number(round.paused_at) : null,
        accumulated_pause_seconds: Number(round.accumulated_pause_seconds),
      }) <= 0
    )
      throw new Error("Submissions are currently locked");
    const [question] =
      await tx`SELECT id FROM coding_questions WHERE id=${questionId}`;
    if (!question) throw new Error("Coding question not found");
    const [successfulRun] =
      await tx`SELECT id FROM submission_jobs WHERE participant_id=${session.id} AND question_id=${questionId} AND mode='run' AND status='completed' AND source=${source} AND COALESCE((result_json->>'executionOk')::boolean, false)=true ORDER BY created_at DESC LIMIT 1`;
    if (!successfulRun)
      throw new Error("Run this exact code successfully before submitting it");
    const active =
      await tx`SELECT id FROM submission_jobs WHERE participant_id=${session.id} AND status IN ('queued','running') LIMIT 1`;
    if (active.length)
      throw new Error("A submission is already queued or running");
    const [submission] =
      await tx`INSERT INTO submissions (participant_id, question_id, language, source, verdict, created_at) VALUES (${session.id}, ${questionId}, ${p.language}, ${source}, 'queued', ${Date.now()}) RETURNING id`;
    submissionId = submission.id;
    await tx`INSERT INTO submission_jobs (submission_id, participant_id, question_id, language, source, mode) VALUES (${submission.id}, ${session.id}, ${questionId}, ${p.language}, ${source}, 'submit')`;
  });
  return json(
    {
      queued: true,
      submissionId: String(submissionId),
      state: await (await snapshot(request)).json(),
    },
    202,
  );
}

async function finishCoding(request: Request) {
  const session = await requireRole(request, "participant");
  if (!session)
    return json({ error: "Participant authorization required" }, 403);
  const database = db();
  const [round] = await database`SELECT status FROM rounds WHERE id='round2'`;
  if (round?.status !== "active")
    return json({ error: "Round 2 is not active" }, 409);
  const [active] =
    await database`SELECT id FROM submission_jobs WHERE participant_id=${session.id} AND status IN ('queued','running') LIMIT 1`;
  if (active)
    return json(
      { error: "Wait for the current execution to finish before turning in" },
      409,
    );
  const [{ total, attempted }] = await database<
    { total: number; attempted: number }[]
  >`SELECT (SELECT count(*)::int FROM coding_questions) AS total, count(DISTINCT question_id)::int AS attempted FROM submission_jobs WHERE participant_id=${session.id} AND mode='submit' AND status='completed'`;
  if (attempted < total)
    return json(
      {
        error: `Execute a submission for every question before turning in (${attempted}/${total} attempted)`,
      },
      409,
    );
  const now = Date.now();
  await database`UPDATE participants SET coding_submitted_at=COALESCE(coding_submitted_at, ${now}), completion_time=COALESCE(completion_time, ${now}), status='completed' WHERE user_id=${session.id}`;
  return snapshot(request);
}

function serviceError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (
    /DATABASE_URL|SESSION_SECRET|EVENT_HOST_PASSWORD|Database is not configured|must contain at least|must use a postgres:/i.test(
      message,
    )
  )
    return message;
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED/i.test(message))
    return "Database cannot be reached. Ensure Docker is running and the Postgres container is started: docker start code-auction-db";
  if (/password authentication failed/i.test(message))
    return "Database rejected credentials. Check DATABASE_URL in .env.local.";
  if (/relation .* does not exist/i.test(message))
    return "Database is connected but not initialized. Run: npm run db:migrate";
  return "Event service unavailable";
}

export async function GET(request: Request) {
  try {
    await ensureSeeded();
    const view = new URL(request.url).searchParams.get("view");
    const liveOnly = view === "live" || view === "private";
    return await snapshot(request, liveOnly, view === "live");
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "api-error",
        action: "snapshot",
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return json({ error: serviceError(error) }, 503);
  }
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  try {
    const action = String(body.action || "");
    if (action === "login") return await login(request, body);
    if (action === "logout")
      return json({ ok: true }, 200, {
        "Set-Cookie": clearSessionCookie(request),
      });
    if (action === "host-control") return await hostAction(request, body);
    if (action === "participant-control")
      return await participantControl(request, body);
    if (action === "security-violation")
      return await recordSecurityViolation(request, body);
    if (action === "add-teams") return await addTeams(request, body);
    if (action === "remove-all-teams") return await removeAllTeams(request);
    if (action === "add-questions") return await addQuestions(request, body);
    if (action === "manual-score") return await manualScore(request, body);
    if (action === "answer") return await answerQuestion(request, body);
    if (action === "submit-quiz") return await submitQuiz(request);
    if (action === "select-language")
      return await selectLanguage(request, body);
    if (action === "purchase-help") return await purchaseHelp(request, body);
    if (action === "run-sample") return await runSample(request, body);
    if (action === "submit-code") return await submitCode(request, body);
    if (action === "finish-coding") return await finishCoding(request);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(
      JSON.stringify({
        type: "api-error",
        action: String(body.action || "unknown"),
        error: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    const message = error instanceof Error ? error.message : "";
    const safeMessages = new Set([
      "Participant not found",
      "Purchase limit or balance check failed",
      "You already purchased this help for this question",
      "Submissions are currently locked",
      "All coding questions are already solved",
      "Coding question not found",
      "A submission is already queued or running",
      "Run this exact code successfully before submitting it",
      "No participant IDs are available",
      "Each question needs a title and a complete statement",
      "Question difficulty or points are invalid",
      "Each question needs input/output formats and 1 to 20 test cases",
      "A test case is too large",
      "Exam security is not active",
    ]);
    const databaseError = serviceError(error);
    if (databaseError !== "Event service unavailable")
      return json({ error: databaseError }, 503);
    return safeMessages.has(message)
      ? json({ error: message }, 409)
      : json({ error: "Request could not be completed" }, 500);
  }
}
