import { env } from "cloudflare:workers";
import { clearSessionCookie, createSession, hashPassword, readSession, safeEqual, sessionCookie } from "@/lib/event-auth";
import { db, ensureSeeded, remaining } from "@/lib/event-db";

type Body = Record<string, unknown>;
const json = (data: unknown, status = 200, headers?: HeadersInit) => {
  const safeHeaders = new Headers(headers);
  safeHeaders.set("Cache-Control", "no-store, max-age=0");
  safeHeaders.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers: safeHeaders });
};

async function snapshot(request: Request) {
  const session = await readSession(request);
  if (!session) return json({ error: "Authentication required" }, 401);
  const database = db();
  const rounds = await database.prepare("SELECT * FROM rounds ORDER BY id").all<Record<string, any>>();
  const roundMap = Object.fromEntries(rounds.results.map((r) => [r.id, { ...r, remainingSeconds: remaining(r) }]));
  const leaderboard = await database.prepare(
    "SELECT u.id, u.name, u.college, p.coins, p.quiz_correct AS quizCorrect, p.coding_score AS codingScore, p.language, p.current_question AS currentQuestion, p.solved, p.helps_used AS helpsUsed, p.completion_time AS completionTime, p.status, p.last_seen AS lastSeen, u.locked, u.disqualified FROM participants p JOIN users u ON u.id=p.user_id ORDER BY p.solved DESC, p.coding_score DESC, p.helps_used ASC, COALESCE(p.completion_time, 9999999999999) ASC",
  ).all();
  if (session.role === "host") {
    return json({ session, rounds: roundMap, leaderboard: leaderboard.results, serverTime: Date.now() });
  }
  await database.prepare("UPDATE participants SET last_seen=?, status=CASE WHEN status='waiting' THEN status ELSE 'online' END WHERE user_id=?").bind(Date.now(), session.id).run();
  const participant = await database.prepare(
    "SELECT u.id, u.name, u.college, u.locked, u.disqualified, p.quiz_submitted_at AS quizSubmittedAt, p.quiz_correct AS quizCorrect, p.coins, p.coding_score AS codingScore, p.language, p.current_question AS currentQuestion, p.solved, p.helps_used AS helpsUsed, p.completion_time AS completionTime, p.status, p.last_seen AS lastSeen FROM users u JOIN participants p ON p.user_id=u.id WHERE u.id=?",
  ).bind(session.id).first<Record<string, any>>();
  const quiz = await database.prepare(
    "SELECT id, category, difficulty, prompt, options_json AS optionsJson, coin_value AS coinValue FROM quiz_questions ORDER BY id",
  ).all<Record<string, any>>();
  const answers = await database.prepare("SELECT question_id AS questionId, answer_index AS answerIndex FROM quiz_answers WHERE participant_id=?").bind(session.id).all();
  const problems = await database.prepare(
    "SELECT id, title, difficulty, points, statement, input_format AS inputFormat, output_format AS outputFormat, sample_input AS sampleInput, sample_output AS sampleOutput FROM coding_questions ORDER BY id",
  ).all();
  const purchases = await database.prepare("SELECT id, question_id AS questionId, kind, cost, content, created_at AS createdAt FROM help_purchases WHERE participant_id=? ORDER BY created_at").bind(session.id).all();
  return json({
    session,
    participant,
    rounds: roundMap,
    leaderboard: leaderboard.results,
    quiz: quiz.results.map((q) => ({ ...q, options: JSON.parse(q.optionsJson), optionsJson: undefined })),
    answers: answers.results,
    problems: problems.results,
    purchases: purchases.results,
    serverTime: Date.now(),
    judgeConfigured: Boolean((env as unknown as Record<string, string>).JUDGE0_URL),
  });
}

async function login(request: Request, body: Body) {
  await ensureSeeded();
  const id = String(body.id || "").trim().toUpperCase();
  const role = body.role === "host" ? "host" : "participant";
  const user = await db().prepare("SELECT * FROM users WHERE id=? AND role=?").bind(id, role).first<Record<string, any>>();
  if (!user || user.locked || user.disqualified) return json({ error: "Invalid credentials or account unavailable" }, 401);
  const supplied = await hashPassword(String(body.password || ""), user.password_salt);
  if (!safeEqual(supplied, user.password_hash)) return json({ error: "Invalid credentials or account unavailable" }, 401);
  const token = await createSession(user.id, user.role);
  const authHeaders = new Headers(request.headers);
  authHeaders.set("cookie", "ca_session=" + token);
  const response = await snapshot(new Request(request.url, { headers: authHeaders }));
  const headers = new Headers(response.headers);
  headers.set("Set-Cookie", sessionCookie(token, request));
  return new Response(response.body, { status: response.status, headers });
}

async function requireRole(request: Request, role?: "host" | "participant") {
  const session = await readSession(request);
  if (!session || (role && session.role !== role)) return null;
  return session;
}

async function hostAction(request: Request, body: Body) {
  const session = await requireRole(request, "host");
  if (!session) return json({ error: "Host authorization required" }, 403);
  const action = String(body.control || "");
  const id = String(body.round || "round2");
  const database = db();
  const row = await database.prepare("SELECT * FROM rounds WHERE id=?").bind(id).first<Record<string, any>>();
  if (!row) return json({ error: "Round not found" }, 404);
  const now = Date.now();
  if (action === "start") await database.prepare("UPDATE rounds SET status='active', started_at=COALESCE(started_at, ?), paused_at=NULL, updated_at=? WHERE id=?").bind(now, now, id).run();
  else if (action === "pause" && row.status === "active") await database.prepare("UPDATE rounds SET status='paused', paused_at=?, updated_at=? WHERE id=?").bind(now, now, id).run();
  else if (action === "resume" && row.status === "paused") await database.prepare("UPDATE rounds SET status='active', accumulated_pause_seconds=accumulated_pause_seconds+CAST((?-paused_at)/1000 AS INTEGER), paused_at=NULL, updated_at=? WHERE id=?").bind(now, now, id).run();
  else if (action === "add") {
    const seconds = Math.min(1800, Math.max(0, Number(body.seconds || 0)));
    await database.prepare("UPDATE rounds SET duration_seconds=duration_seconds+?, updated_at=? WHERE id=?").bind(seconds, now, id).run();
  } else if (action === "end") await database.prepare("UPDATE rounds SET status='ended', updated_at=? WHERE id=?").bind(now, id).run();
  else if (action === "publish") await database.prepare("UPDATE rounds SET results_published=1, updated_at=? WHERE id='round2'").bind(now).run();
  else return json({ error: "Invalid control transition" }, 400);
  return snapshot(request);
}

async function participantControl(request: Request, body: Body) {
  const session = await requireRole(request, "host");
  if (!session) return json({ error: "Host authorization required" }, 403);
  const target = String(body.participantId || "");
  const control = String(body.control || "");
  if (!/^CA-\d{4}$/.test(target)) return json({ error: "Invalid participant" }, 400);
  if (control === "lock") await db().prepare("UPDATE users SET locked=1 WHERE id=? AND role='participant'").bind(target).run();
  else if (control === "unlock") await db().prepare("UPDATE users SET locked=0 WHERE id=? AND role='participant'").bind(target).run();
  else if (control === "disqualify") await db().batch([
    db().prepare("UPDATE users SET disqualified=1, locked=1 WHERE id=? AND role='participant'").bind(target),
    db().prepare("UPDATE participants SET status='disqualified' WHERE user_id=?").bind(target),
  ]);
  else return json({ error: "Invalid participant control" }, 400);
  return snapshot(request);
}

async function answerQuestion(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const round = await db().prepare("SELECT * FROM rounds WHERE id='round1'").first<Record<string, any>>();
  if (!round || round.status !== "active" || remaining(round) <= 0) return json({ error: "Round 1 is not active" }, 409);
  const questionId = Number(body.questionId);
  const answerIndex = Number(body.answerIndex);
  if (!Number.isInteger(questionId) || questionId < 1 || questionId > 40 || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) return json({ error: "Invalid answer" }, 400);
  await db().prepare("INSERT INTO quiz_answers (participant_id, question_id, answer_index, answered_at) VALUES (?, ?, ?, ?) ON CONFLICT(participant_id, question_id) DO UPDATE SET answer_index=excluded.answer_index, answered_at=excluded.answered_at").bind(session.id, questionId, answerIndex, Date.now()).run();
  return json({ ok: true });
}

async function submitQuiz(request: Request) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const database = db();
  const participant = await database.prepare("SELECT * FROM participants WHERE user_id=?").bind(session.id).first<Record<string, any>>();
  if (participant?.quiz_submitted_at) return snapshot(request);
  const result = await database.prepare("SELECT COUNT(*) AS correct, COALESCE(SUM(q.coin_value),0) AS coins FROM quiz_answers a JOIN quiz_questions q ON q.id=a.question_id WHERE a.participant_id=? AND a.answer_index=q.correct_index").bind(session.id).first<{ correct: number; coins: number }>();
  const coins = Number(result?.coins || 0);
  const now = Date.now();
  await database.batch([
    database.prepare("UPDATE participants SET quiz_submitted_at=?, quiz_correct=?, coins=?, status='waiting' WHERE user_id=? AND quiz_submitted_at IS NULL").bind(now, Number(result?.correct || 0), coins, session.id),
    database.prepare("INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) VALUES (?, 'quiz_award', 'Round 1 quiz earnings', 0, ?, ?, ?)").bind(session.id, coins, coins, now),
  ]);
  return snapshot(request);
}

async function selectLanguage(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const language = body.language === "Java" ? "Java" : body.language === "Python" ? "Python" : null;
  if (!language) return json({ error: "Unsupported language" }, 400);
  const round = await db().prepare("SELECT * FROM rounds WHERE id='round2'").first<Record<string, any>>();
  if (!round || round.status !== "active") return json({ error: "Round 2 is not active" }, 409);
  const update = await db().prepare("UPDATE participants SET language=?, status='coding' WHERE user_id=? AND language IS NULL").bind(language, session.id).run();
  if (!update.meta.changes) return json({ error: "Language is already locked" }, 409);
  return snapshot(request);
}

const helpCosts: Record<string, number> = { small: 200, algorithm: 300, pseudocode: 450, reveal: 650, ai: 800 };
async function purchaseHelp(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const kind = String(body.kind || "");
  const cost = helpCosts[kind];
  if (!cost) return json({ error: "Invalid help type" }, 400);
  const database = db();
  const participant = await database.prepare("SELECT * FROM participants WHERE user_id=?").bind(session.id).first<Record<string, any>>();
  if (!participant?.language || participant.helps_used >= 3 || participant.coins < cost) return json({ error: "Purchase limit or balance check failed" }, 409);
  const question = await database.prepare("SELECT * FROM coding_questions WHERE id=?").bind(participant.current_question).first<Record<string, any>>();
  if (!question) return json({ error: "Question unavailable" }, 404);
  const hints = JSON.parse(question.hints_json) as string[];
  const content = kind === "small" ? hints[0] : kind === "algorithm" ? hints[1] : kind === "pseudocode" ? hints[2] : kind === "reveal" ? "Starter guidance: " + hints.join(" ") : "AI guidance unlocked for three messages. Focus on explaining and debugging, never a complete solution.";
  const before = participant.coins;
  const after = before - cost;
  const now = Date.now();
  const update = database.prepare("UPDATE participants SET coins=coins-?, helps_used=helps_used+1 WHERE user_id=? AND coins>=? AND helps_used<3").bind(cost, session.id, cost);
  const purchase = database.prepare("INSERT INTO help_purchases (participant_id, question_id, kind, cost, language, content, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM participants WHERE user_id=? AND coins=?)").bind(session.id, question.id, kind, cost, participant.language, content, now, session.id, after);
  const ledger = database.prepare("INSERT INTO coin_transactions (participant_id, type, description, balance_before, amount, balance_after, created_at) SELECT ?, 'help_purchase', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM participants WHERE user_id=? AND coins=?)").bind(session.id, kind, before, -cost, after, now, session.id, after);
  await database.batch([update, purchase, ledger]);
  return snapshot(request);
}

async function judge(source: string, language: string, input: string, expected: string) {
  const config = env as unknown as Record<string, string>;
  if (!config.JUDGE0_URL) throw new Error("Judge0 is not configured");
  const response = await fetch(config.JUDGE0_URL.replace(/\/$/, "") + "/submissions?base64_encoded=false&wait=true", {
    method: "POST",
    headers: { "content-type": "application/json", ...(config.JUDGE0_API_KEY ? { "X-Auth-Token": config.JUDGE0_API_KEY } : {}) },
    body: JSON.stringify({ source_code: source, language_id: language === "Python" ? 71 : 62, stdin: input, expected_output: expected, cpu_time_limit: 2, memory_limit: 131072, enable_network: false }),
  });
  if (!response.ok) throw new Error("Judge service rejected the submission");
  return await response.json() as Record<string, any>;
}

async function submitCode(request: Request, body: Body) {
  const session = await requireRole(request, "participant");
  if (!session) return json({ error: "Participant authorization required" }, 403);
  const source = String(body.source || "");
  if (!source || source.length > 50000) return json({ error: "Source must be between 1 and 50,000 characters" }, 400);
  const database = db();
  const participant = await database.prepare("SELECT * FROM participants WHERE user_id=?").bind(session.id).first<Record<string, any>>();
  const round = await database.prepare("SELECT * FROM rounds WHERE id='round2'").first<Record<string, any>>();
  if (!participant?.language || !round || round.status !== "active" || remaining(round) <= 0) return json({ error: "Submissions are currently locked" }, 409);
  const questionId = participant.current_question;
  const cases = await database.prepare("SELECT input, expected_output FROM test_cases WHERE question_id=? ORDER BY position").bind(questionId).all<Record<string, string>>();
  let passed = 0;
  const refs: string[] = [];
  try {
    for (const test of cases.results) {
      const verdict = await judge(source, participant.language, test.input, test.expected_output);
      if (verdict.status?.id === 3) passed++;
      if (verdict.token) refs.push(verdict.token);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Judge service unavailable" }, 503);
  }
  const solved = passed === 5;
  const question = await database.prepare("SELECT points FROM coding_questions WHERE id=?").bind(questionId).first<{ points: number }>();
  const existing = await database.prepare("SELECT 1 AS found FROM solved_problems WHERE participant_id=? AND question_id=?").bind(session.id, questionId).first();
  const now = Date.now();
  const statements = [
    database.prepare("INSERT INTO submissions (participant_id, question_id, language, source, passed_count, verdict, judge_reference, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(session.id, questionId, participant.language, source, passed, solved ? "accepted" : "failed", refs.join(","), now),
  ];
  if (solved && !existing) {
    const points = Number(question?.points || 0);
    statements.push(database.prepare("INSERT INTO solved_problems (participant_id, question_id, solved_at, points_awarded) VALUES (?, ?, ?, ?)").bind(session.id, questionId, now, points));
    statements.push(database.prepare("UPDATE participants SET solved=solved+1, coding_score=coding_score+?, current_question=MIN(5,current_question+1), completion_time=CASE WHEN current_question=5 THEN ? ELSE completion_time END WHERE user_id=?").bind(points, now, session.id));
  }
  await database.batch(statements);
  return json({ passed, solved, state: (await (await snapshot(request)).json()) });
}

export async function GET(request: Request) {
  try { await ensureSeeded(); return await snapshot(request); }
  catch (error) { console.error(error); return json({ error: "Event service unavailable" }, 503); }
}

export async function POST(request: Request) {
  let body: Body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  try {
    const action = String(body.action || "");
    if (action === "login") return login(request, body);
    if (action === "logout") return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(request) });
    if (action === "host-control") return hostAction(request, body);
    if (action === "participant-control") return participantControl(request, body);
    if (action === "answer") return answerQuestion(request, body);
    if (action === "submit-quiz") return submitQuiz(request);
    if (action === "select-language") return selectLanguage(request, body);
    if (action === "purchase-help") return purchaseHelp(request, body);
    if (action === "submit-code") return submitCode(request, body);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "Request could not be completed" }, 500);
  }
}
