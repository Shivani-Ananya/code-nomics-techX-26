import { clearSessionCookie, createSession, hashPassword, readSession, safeEqual, sessionCookie } from "@/lib/event-auth";
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

async function loginClientKey(request: Request, id: string) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${id}|${address}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function recordLoginFailure(key: string) {
  const database = db();
  const now = Date.now();
  const [row] = await database<{ failed_count: number; first_failed_at: string }[]>`SELECT failed_count, first_failed_at FROM login_rate_limits WHERE client_key=${key}`;
  const within = row && now - Number(row.first_failed_at) <= LOGIN_WINDOW_MS;
  const count = within ? row.failed_count + 1 : 1;
  const first = within ? Number(row.first_failed_at) : now;
  const blocked = count >= 5 ? now + LOGIN_BLOCK_MS : null;
  await database`INSERT INTO login_rate_limits (client_key, failed_count, first_failed_at, blocked_until, updated_at)
    VALUES (${key}, ${count}, ${first}, ${blocked}, ${now})
    ON CONFLICT (client_key) DO UPDATE SET failed_count=excluded.failed_count, first_failed_at=excluded.first_failed_at, blocked_until=excluded.blocked_until, updated_at=excluded.updated_at`;
}

async function snapshot(request: Request) {
  const session = await readSession(request);
  if (!session) return json({ error: "Authentication required" }, 401);
  const database = db();
  const rounds = await database<Row[]>`SELECT * FROM rounds ORDER BY id`;
  const roundMap = Object.fromEntries(rounds.map((r) => [r.id, { ...r, started_at: r.started_at ? Number(r.started_at) : null, paused_at: r.paused_at ? Number(r.paused_at) : null, remainingSeconds: remaining({ status: String(r.status), duration_seconds: Number(r.duration_seconds), started_at: r.started_at ? Number(r.started_at) : null, paused_at: r.paused_at ? Number(r.paused_at) : null, accumulated_pause_seconds: Number(r.accumulated_pause_seconds) }) }]));
  const leaderboard = await database`SELECT u.id, u.name, u.college, p.coins, p.quiz_correct AS "quizCorrect", p.coding_score AS "codingScore", p.language, p.current_question AS "currentQuestion", p.solved, p.helps_used AS "helpsUsed", p.completion_time AS "completionTime", p.status, p.last_seen::float8 AS "lastSeen", u.locked, u.disqualified FROM participants p JOIN users u ON u.id=p.user_id ORDER BY p.solved DESC, p.coding_score DESC, p.helps_used ASC, COALESCE(p.completion_time, 9999999999999) ASC`;
  if (session.role === "host") return json({ session, rounds: roundMap, leaderboard, serverTime: Date.now(), judgeConfigured: queueEnabled() });

  await database`UPDATE participants SET last_seen=${Date.now()}, status=CASE WHEN status='waiting' THEN status ELSE 'online' END WHERE user_id=${session.id}`;
  const [participant] = await database`SELECT u.id, u.name, u.college, u.locked, u.disqualified, p.quiz_submitted_at::float8 AS "quizSubmittedAt", p.quiz_correct AS "quizCorrect", p.coins, p.coding_score AS "codingScore", p.language, p.current_question AS "currentQuestion", p.solved, p.helps_used AS "helpsUsed", p.completion_time::float8 AS "completionTime", p.status, p.last_seen::float8 AS "lastSeen" FROM users u JOIN participants p ON p.user_id=u.id WHERE u.id=${session.id}`;
  const quiz = await database`SELECT id, category, difficulty, prompt, options_json AS options, coin_value AS "coinValue" FROM quiz_questions ORDER BY id`;
  const answers = await database`SELECT question_id AS "questionId", answer_index AS "answerIndex" FROM quiz_answers WHERE participant_id=${session.id}`;
  const problems = await database`SELECT id, title, difficulty, points, statement, input_format AS "inputFormat", output_format AS "outputFormat", sample_input AS "sampleInput", sample_output AS "sampleOutput" FROM coding_questions ORDER BY id`;
  const purchases = await database`SELECT id, question_id AS "questionId", kind, cost, content, created_at::float8 AS "createdAt" FROM help_purchases WHERE participant_id=${session.id} ORDER BY created_at`;
  const [latestSubmission] = await database`SELECT j.id, j.status, s.passed_count AS "passedCount", s.verdict, j.last_error AS "lastError", EXTRACT(EPOCH FROM j.created_at)*1000 AS "createdAt", s.completed_at::float8 AS "completedAt" FROM submission_jobs j JOIN submissions s ON s.id=j.submission_id WHERE j.participant_id=${session.id} ORDER BY j.created_at DESC LIMIT 1`;
  return json({ session, participant, rounds: roundMap, leaderboard, quiz, answers, problems, purchases, latestSubmission: latestSubmission || null, serverTime: Date.now(), judgeConfigured: queueEnabled() });
}

async function requireRole(request: Request, role?: "host" | "participant") {
  const session = await readSession(request);
  if (!session || (role && session.role !== role)) return null;
  const [user] = await db()`SELECT role, locked, disqualified FROM users WHERE id=${session.id}`;
  return user && user.role === session.role && !user.locked && !user.disqualified ? session : null;
}

async function login(request: Request, body: Body) {
  await ensureSeeded();
  const id = String(body.id || "").trim().toUpperCase();
  const role = body.role === "host" ? "host" : "participant";
  if (!/^(HOST-\d{2}|CA-\d{4})$/.test(id) || String(body.password || "").length > 256) return json({ error: "Invalid credentials or account unavailable" }, 401);
  const key = await loginClientKey(request, id);
  const [limit] = await db()`SELECT blocked_until FROM login_rate_limits WHERE client_key=${key}`;
  if (Number(limit?.blocked_until || 0) > Date.now()) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429, { "Retry-After": "900" });
  const [user] = await db()`SELECT * FROM users WHERE id=${id} AND role=${role}`;
  if (!user || user.locked || user.disqualified || !safeEqual(await hashPassword(String(body.password || ""), String(user.password_salt || "")), String(user.password_hash || ""))) {
    await recordLoginFailure(key);
    return json({ error: "Invalid credentials or account unavailable" }, 401);
  }
  await db()`DELETE FROM login_rate_limits WHERE client_key=${key}`;
  const token = await createSession(String(user.id), role);
  const headers = new Headers(request.headers); headers.set("cookie", `ca_session=${token}`);
  const response = await snapshot(new Request(request.url, { headers }));
  const responseHeaders = new Headers(response.headers); responseHeaders.set("Set-Cookie", sessionCookie(token, request));
  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

async function hostAction(request: Request, body: Body) {
  if (!await requireRole(request, "host")) return json({ error: "Host authorization required" }, 403);
  const database = db(), id = String(body.round || "round2"), action = String(body.control || ""), now = Date.now();
  const [round] = await database`SELECT * FROM rounds WHERE id=${id}`;
  if (!round) return json({ error: "Round not found" }, 404);
  if (action === "start") await database`UPDATE rounds SET status='active', started_at=COALESCE(started_at, ${now}), paused_at=NULL, updated_at=${now} WHERE id=${id}`;
  else if (action === "pause" && round.status === "active") await database`UPDATE rounds SET status='paused', paused_at=${now}, updated_at=${now} WHERE id=${id}`;
  else if (action === "resume" && round.status === "paused") await database`UPDATE rounds SET status='active', accumulated_pause_seconds=accumulated_pause_seconds+((${now}-paused_at)/1000)::int, paused_at=NULL, updated_at=${now} WHERE id=${id}`;
  else if (action === "add") await database`UPDATE rounds SET duration_seconds=duration_seconds+${Math.min(1800, Math.max(0, Number(body.seconds || 0)))}, updated_at=${now} WHERE id=${id}`;
  else if (action === "end") await database`UPDATE rounds SET status='ended', updated_at=${now} WHERE id=${id}`;
  else if (action === "publish") await database`UPDATE rounds SET results_published=true, updated_at=${now} WHERE id='round2'`;
  else return json({ error: "Invalid control transition" }, 400);
  return snapshot(request);
}

async function participantControl(request: Request, body: Body) {
  if (!await requireRole(request, "host")) return json({ error: "Host authorization required" }, 403);
  const target = String(body.participantId || ""), control = String(body.control || ""), database = db();
  if (!/^CA-\d{4}$/.test(target)) return json({ error: "Invalid participant" }, 400);
  if (control === "lock") await database`UPDATE users SET locked=true WHERE id=${target} AND role='participant'`;
  else if (control === "unlock") await database`UPDATE users SET locked=false WHERE id=${target} AND role='participant'`;
  else if (control === "disqualify") await database.begin(async tx => { await tx`UPDATE users SET disqualified=true, locked=true WHERE id=${target}`; await tx`UPDATE participants SET status='disqualified' WHERE user_id=${target}`; });
  else return json({ error: "Invalid participant control" }, 400);
  return snapshot(request);
}

async function manualScore(request: Request, body: Body) {
  const session = await requireRole(request, "host");
  if (!session) return json({ error: "Host authorization required" }, 403);
  const target = String(body.participantId || ""), delta = Number(body.delta), reason = String(body.reason || "").trim(), database = db();
  if (!/^CA-\d{4}$/.test(target) || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 5000) return json({ error: "Invalid score adjustment" }, 400);
  if (reason.length < 5 || reason.length > 200) return json({ error: "Provide a reason between 5 and 200 characters" }, 400);
  await database.begin(async tx => {
    const [p] = await tx`SELECT coding_score FROM participants WHERE user_id=${target} FOR UPDATE`;
    if (!p) throw new Error("Participant not found");
    const before = Number(p.coding_score), after = Math.max(0, before + delta);
    await tx`UPDATE participants SET coding_score=${after} WHERE user_id=${target}`;
    await tx`INSERT INTO score_adjustments (participant_id, host_id, delta, reason, score_before, score_after, created_at) VALUES (${target}, ${session.id}, ${after - before}, ${reason}, ${before}, ${after}, ${Date.now()})`;
  });
  return snapshot(request);
}

async function answerQuestion(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const questionId = Number(body.questionId), answerIndex = Number(body.answerIndex), database = db();
  const [round] = await database<Row[]>`SELECT * FROM rounds WHERE id='round1'`;
  if (!round || round.status !== "active" || remaining({ status: String(round.status), duration_seconds: Number(round.duration_seconds), started_at: Number(round.started_at), paused_at: round.paused_at ? Number(round.paused_at) : null, accumulated_pause_seconds: Number(round.accumulated_pause_seconds) }) <= 0) return json({ error: "Quiz is not active" }, 409);
  if (!Number.isInteger(questionId) || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return json({ error: "Invalid answer" }, 400);
  await database`INSERT INTO quiz_answers (participant_id, question_id, answer_index, answered_at) VALUES (${session.id}, ${questionId}, ${answerIndex}, ${Date.now()}) ON CONFLICT (participant_id, question_id) DO UPDATE SET answer_index=excluded.answer_index, answered_at=excluded.answered_at`;
  return json({ ok: true });
}

async function submitQuiz(request: Request) {
  const session = await requireRole(request, "participant"); if (!session) return json({ error: "Participant authorization required" }, 403);
  const database = db();
  await database.begin(async tx => {
    const [p] = await tx`SELECT quiz_submitted_at FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    if (p?.quiz_submitted_at) return;
    const [result] = await tx`SELECT count(*)::int AS correct, COALESCE(sum(q.coin_value),0)::int AS coins FROM quiz_answers a JOIN quiz_questions q ON q.id=a.question_id WHERE a.participant_id=${session.id} AND a.answer_index=q.correct_index`;
    const coins = Number(result.coins), now = Date.now();
    await tx`UPDATE participants SET quiz_submitted_at=${now}, quiz_correct=${Number(result.correct)}, coins=${coins}, status='waiting' WHERE user_id=${session.id}`;
    await tx`INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) VALUES (${session.id}, 'quiz_award', 'Round 1 quiz earnings', 0, ${coins}, ${coins}, ${now})`;
  });
  return snapshot(request);
}

async function selectLanguage(request: Request, body: Body) {
  const session = await requireRole(request, "participant"); if (!session) return json({ error: "Participant authorization required" }, 403);
  const language = body.language === "Python" || body.language === "Java" ? body.language : null; if (!language) return json({ error: "Unsupported language" }, 400);
  const [round] = await db()`SELECT status FROM rounds WHERE id='round2'`; if (round?.status !== "active") return json({ error: "Round 2 is not active" }, 409);
  const updated = await db()`UPDATE participants SET language=${language}, status='coding' WHERE user_id=${session.id} AND language IS NULL RETURNING user_id`;
  if (!updated.length) return json({ error: "Language is already locked" }, 409); return snapshot(request);
}

const helpCosts: Record<string, number> = { small: 200, algorithm: 300, pseudocode: 450, reveal: 650, ai: 800 };
async function purchaseHelp(request: Request, body: Body) {
  const session = await requireRole(request, "participant"); if (!session) return json({ error: "Participant authorization required" }, 403);
  const kind = String(body.kind || ""), cost = helpCosts[kind]; if (!cost) return json({ error: "Invalid help type" }, 400);
  const database = db();
  await database.begin(async tx => {
    const [p] = await tx`SELECT * FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    if (!p?.language || Number(p.helps_used) >= 3 || Number(p.coins) < cost) throw new Error("Purchase limit or balance check failed");
    const [q] = await tx`SELECT id, hints_json FROM coding_questions WHERE id=${p.current_question}`;
    const hints = q.hints_json as string[];
    const content = kind === "small" ? hints[0] : kind === "algorithm" ? hints[1] : kind === "pseudocode" ? hints[2] : kind === "reveal" ? `Starter guidance: ${hints.join(" ")}` : "AI guidance unlocked for three messages. Focus on explaining and debugging, never a complete solution.";
    const before = Number(p.coins), after = before - cost, now = Date.now();
    await tx`UPDATE participants SET coins=${after}, helps_used=helps_used+1 WHERE user_id=${session.id}`;
    await tx`INSERT INTO help_purchases (participant_id, question_id, kind, cost, language, content, created_at) VALUES (${session.id}, ${q.id}, ${kind}, ${cost}, ${p.language}, ${content}, ${now})`;
    await tx`INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) VALUES (${session.id}, 'help_purchase', ${kind}, ${before}, ${-cost}, ${after}, ${now})`;
  });
  return snapshot(request);
}

async function submitCode(request: Request, body: Body) {
  const session = await requireRole(request, "participant"); if (!session) return json({ error: "Participant authorization required" }, 403);
  if (!queueEnabled()) return json({ error: "Judge queue is disabled" }, 503);
  const source = String(body.source || ""); if (!source || source.length > 50000) return json({ error: "Source must be between 1 and 50,000 characters" }, 400);
  const database = db(); let submissionId: unknown;
  await database.begin(async tx => {
    const [p] = await tx`SELECT * FROM participants WHERE user_id=${session.id} FOR UPDATE`;
    const [round] = await tx<Row[]>`SELECT * FROM rounds WHERE id='round2'`;
    if (!p?.language || !round || round.status !== "active" || remaining({ status: String(round.status), duration_seconds: Number(round.duration_seconds), started_at: Number(round.started_at), paused_at: round.paused_at ? Number(round.paused_at) : null, accumulated_pause_seconds: Number(round.accumulated_pause_seconds) }) <= 0) throw new Error("Submissions are currently locked");
    const active = await tx`SELECT id FROM submission_jobs WHERE participant_id=${session.id} AND status IN ('queued','running') LIMIT 1`;
    if (active.length) throw new Error("A submission is already queued or running");
    const [submission] = await tx`INSERT INTO submissions (participant_id, question_id, language, source, verdict, created_at) VALUES (${session.id}, ${p.current_question}, ${p.language}, ${source}, 'queued', ${Date.now()}) RETURNING id`;
    submissionId = submission.id;
    await tx`INSERT INTO submission_jobs (submission_id, participant_id, question_id, language, source) VALUES (${submission.id}, ${session.id}, ${p.current_question}, ${p.language}, ${source})`;
  });
  return json({ queued: true, submissionId: String(submissionId), state: await (await snapshot(request)).json() }, 202);
}

export async function GET(request: Request) { try { await ensureSeeded(); return snapshot(request); } catch (error) { console.error(error); return json({ error: "Event service unavailable" }, 503); } }
export async function POST(request: Request) {
  let body: Body; try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    const action = String(body.action || "");
    if (action === "login") return login(request, body);
    if (action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
    if (action === "host-control") return hostAction(request, body);
    if (action === "participant-control") return participantControl(request, body);
    if (action === "manual-score") return manualScore(request, body);
    if (action === "answer") return answerQuestion(request, body);
    if (action === "submit-quiz") return submitQuiz(request);
    if (action === "select-language") return selectLanguage(request, body);
    if (action === "purchase-help") return purchaseHelp(request, body);
    if (action === "submit-code") return submitCode(request, body);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "";
    const safeMessages = new Set(["Participant not found", "Purchase limit or balance check failed", "Submissions are currently locked", "A submission is already queued or running"]);
    return safeMessages.has(message) ? json({ error: message }, 409) : json({ error: "Request could not be completed" }, 500);
  }
}
