import { performance } from "node:perf_hooks";
import crypto from "node:crypto";
import postgres from "postgres";

const BASE_URL = process.env.TEST_BASE_URL || "http://127.0.0.1:5173";
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = process.env.DATABASE_SSL === "true";
const SESSION_SECRET = process.env.SESSION_SECRET;
const SUSTAINED_SECONDS = Number(process.env.SUSTAINED_SECONDS || 600);
const TEST_PROFILE = process.env.LOAD_TEST_PROFILE || "full";
const CIRCUIT_BREAKER_ERROR_RATE = Number(
  process.env.CIRCUIT_BREAKER_ERROR_RATE || 0.05,
);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 8000);
const MAX_USERS = Number(process.env.LOAD_TEST_MAX_USERS || 200);
const POLL_MIN_MS = Number(process.env.LOAD_TEST_POLL_MIN_MS || 12000);
const POLL_MAX_MS = Number(process.env.LOAD_TEST_POLL_MAX_MS || 18000);

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(BASE_URL) && process.env.ALLOW_REMOTE_LOAD_TEST !== "true")
  throw new Error("Remote load testing is disabled. Use localhost or explicitly set ALLOW_REMOTE_LOAD_TEST=true for an authorized test environment.");
if (!DATABASE_URL) throw new Error("DATABASE_URL is required for connection and persistence verification.");
if (!SESSION_SECRET || SESSION_SECRET.length < 32)
  throw new Error("SESSION_SECRET with at least 32 characters is required for dummy load-test sessions.");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function dummySessionCookie(id) {
  const payload = base64url(
    JSON.stringify({ id, role: "participant", exp: Date.now() + 60 * 60 * 1000 }),
  );
  const signature = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `ca_session=${payload}.${signature}`;
}

const stageDefinitions = (
  TEST_PROFILE === "sustained"
    ? [["200 users sustained", 200, SUSTAINED_SECONDS]]
    : TEST_PROFILE === "baseline"
    ? [
        ["10 users", 10, 10],
        ["50 users", 50, 15],
        ["100 users", 100, 20],
        ["150 users", 150, 20],
        ["200 users", 200, 30],
      ]
    : [
        ["10 users", 10, 15],
        ["50 users", 50, 30],
        ["100 users", 100, 45],
        ["150 users", 150, 60],
        ["200 users ramp", 200, 90],
        ["200 users sustained", 200, SUSTAINED_SECONDS],
      ]
).filter(([, users]) => users <= MAX_USERS);

const metrics = {
  requests: [],
  statusCodes: {},
  errors: [],
  sessionLeaks: 0,
  dbSamples: [],
  stages: [],
  activeStageStart: null,
  circuitBreakerTriggered: false,
};

function percentile(sorted, value) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1)];
}

function summarize(samples, elapsedMs) {
  const latencies = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const failures = samples.filter((sample) => !sample.ok);
  const average = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : 0;
  return {
    requests: samples.length,
    successful: samples.length - failures.length,
    errors: failures.length,
    errorRatePercent: Number(((failures.length / Math.max(1, samples.length)) * 100).toFixed(3)),
    throughputRps: Number((samples.length / Math.max(1, elapsedMs / 1000)).toFixed(2)),
    averageMs: Math.round(average),
    p95Ms: Math.round(percentile(latencies, 95)),
    p99Ms: Math.round(percentile(latencies, 99)),
    maxMs: Math.round(latencies.at(-1) || 0),
  };
}

function record(action, durationMs, status, error) {
  const ok = status >= 200 && status < 400;
  metrics.requests.push({ action, durationMs, status, ok });
  metrics.statusCodes[status] = (metrics.statusCodes[status] || 0) + 1;
  if (!ok && metrics.errors.length < 50)
    metrics.errors.push({ action, status, error: String(error || "Request failed").slice(0, 300) });
  if (
    metrics.activeStageStart !== null &&
    !metrics.circuitBreakerTriggered
  ) {
    const stageSamples = metrics.requests.slice(metrics.activeStageStart);
    if (
      stageSamples.length >= 100 &&
      stageSamples.filter((sample) => !sample.ok).length / stageSamples.length >
        CIRCUIT_BREAKER_ERROR_RATE
    ) {
      metrics.circuitBreakerTriggered = true;
      console.error("Circuit breaker triggered during the active stage.");
    }
  }
}

class VirtualParticipant {
  constructor(index) {
    this.index = index;
    this.name = `LoadBot_${String(index).padStart(3, "0")}`;
    this.cookie = "";
    this.id = "";
    this.state = null;
    this.iteration = 0;
  }

  async call(action, payload, method = "POST", view = "live") {
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${BASE_URL}/api/event${method === "GET" ? `?view=${view}` : ""}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(this.cookie ? { cookie: this.cookie } : {}),
        },
        body: method === "POST" ? JSON.stringify({ action, ...payload }) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = response.status;
      const data = await response.json().catch(() => ({}));
      record(action, performance.now() - started, status, data.error);
      if (data.session?.id && this.id && data.session.id !== this.id) metrics.sessionLeaks += 1;
      return { response, data };
    } catch (error) {
      record(action, performance.now() - started, status || 599, error.message);
      return { response: null, data: null, error };
    }
  }

  initialize(id, questions) {
    this.id = id;
    this.cookie = dummySessionCookie(id);
    this.state = { quiz: questions };
  }

  async warmup() {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(`${BASE_URL}/api/event?view=private`, {
        headers: { cookie: this.cookie },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.session?.id !== this.id)
          throw new Error(`Session isolation failed during warm-up for ${this.name}.`);
        this.state = { ...this.state, ...data };
        return;
      }
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      else
        throw new Error(`Warm-up failed for ${this.name} (${response.status}).`);
    }
  }

  async poll(view = "live") {
    const { response, data } = await this.call(`${view}-snapshot`, null, "GET", view);
    if (response?.ok && data) this.state = { ...this.state, ...data };
  }

  async answer() {
    const questions = this.state?.quiz || [];
    if (!questions.length) return;
    const question = questions[(this.index + this.iteration) % questions.length];
    await this.call("answer", {
      questionId: question.id,
      answerIndex: (this.index + this.iteration) % 4,
    });
  }

  async runUntil(endAt) {
    const remainingMs = Math.max(0, endAt - Date.now());
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * Math.min(POLL_MIN_MS, remainingMs / 2)),
    );
    while (Date.now() < endAt && !metrics.circuitBreakerTriggered) {
      await this.poll();
      if ((this.iteration + this.index) % 4 === 0) await this.poll("private");
      if (this.iteration % 5 === 0) await this.answer();
      this.iteration += 1;
      const spread = Math.max(0, POLL_MAX_MS - POLL_MIN_MS);
      await new Promise((resolve) =>
        setTimeout(resolve, POLL_MIN_MS + Math.random() * spread),
      );
    }
  }
}

const database = postgres(DATABASE_URL, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
  prepare: false,
  fetch_types: false,
  ssl: DATABASE_SSL ? "require" : false,
});

async function sampleDatabase(stop) {
  while (!stop.done) {
    try {
      const [sample] = await database`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE state='active')::int AS active,
          count(*) FILTER (WHERE wait_event_type='Lock')::int AS waiting
        FROM pg_stat_activity
      `;
      metrics.dbSamples.push({
        at: Date.now(),
        total: Number(sample.total),
        active: Number(sample.active),
        waiting: Number(sample.waiting),
      });
    } catch (error) {
      if (metrics.errors.length < 50) metrics.errors.push({ action: "db-sample", status: 0, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function stageErrorRate(startIndex) {
  const samples = metrics.requests.slice(startIndex);
  return samples.filter((sample) => !sample.ok).length / Math.max(1, samples.length);
}

async function verifyPersistence() {
  const [answers] = await database`
    SELECT count(*)::int AS count
    FROM quiz_answers a
    JOIN users u ON u.id=a.participant_id
    WHERE u.name LIKE 'LoadBot\_%' ESCAPE '\'
  `;
  const [accepted] = await database`
    SELECT
      count(*)::int AS accepted,
      count(*) FILTER (
        WHERE s.completed_at IS NULL
           OR s.passed_count <> (SELECT count(*) FROM test_cases t WHERE t.question_id=s.question_id)
      )::int AS invalid
    FROM submissions s
    JOIN users u ON u.id=s.participant_id
    WHERE s.verdict='accepted'
      AND u.name LIKE 'LoadBot\_%' ESCAPE '\'
  `;
  return {
    dummyAnswerRows: answers.count,
    acceptedSubmissions: accepted.accepted,
    invalidAcceptedSubmissions: accepted.invalid,
  };
}

async function main() {
  console.log(`Authorized load target: ${BASE_URL}`);
  console.log(`Profile: ${TEST_PROFILE}; sustained 200-user duration: ${SUSTAINED_SECONDS}s`);
  const participants = Array.from({ length: 200 }, (_, index) => new VirtualParticipant(index + 1));
  const dummyRows = await database`
    SELECT id, name, locked, disqualified
    FROM users
    WHERE role='participant' AND name LIKE 'LoadBot\\_%' ESCAPE '\\'
    ORDER BY name
  `;
  const questions = await database`SELECT id FROM quiz_questions ORDER BY id`;
  if (dummyRows.length < 200)
    throw new Error(`Expected 200 dummy accounts, found ${dummyRows.length}. Run the authorized setup first.`);
  for (const participant of participants) {
    const account = dummyRows.find((row) => row.name === participant.name);
    if (!account || account.locked || account.disqualified)
      throw new Error(`Dummy account ${participant.name} is missing or unavailable.`);
    participant.initialize(account.id, questions);
  }
  console.log("Prepared 200 signed dummy sessions without login traffic.");
  console.log("Warming participant sessions in batches of 10...");
  for (let offset = 0; offset < participants.length; offset += 10) {
    await Promise.all(
      participants
        .slice(offset, offset + 10)
        .map((participant) => participant.warmup()),
    );
  }
  console.log("Participant session warm-up complete; measurements start now.");

  const stopSampler = { done: false };
  const sampler = sampleDatabase(stopSampler);
  const suiteStarted = Date.now();
  for (const [name, users, durationSeconds] of stageDefinitions) {
    const requestStart = metrics.requests.length;
    metrics.activeStageStart = requestStart;
    const stageStarted = Date.now();
    const endAt = stageStarted + durationSeconds * 1000;
    console.log(`Starting ${name} for ${durationSeconds}s...`);
    await Promise.all(participants.slice(0, users).map((participant) => participant.runUntil(endAt)));
    const report = summarize(metrics.requests.slice(requestStart), Date.now() - stageStarted);
    metrics.activeStageStart = null;
    metrics.stages.push({ name, users, durationSeconds, ...report });
    console.log(JSON.stringify(metrics.stages.at(-1)));
    if (metrics.requests.length - requestStart >= 100 && stageErrorRate(requestStart) > CIRCUIT_BREAKER_ERROR_RATE) {
      metrics.circuitBreakerTriggered = true;
      console.error(`Circuit breaker triggered at ${(stageErrorRate(requestStart) * 100).toFixed(2)}% errors.`);
      break;
    }
  }
  stopSampler.done = true;
  await sampler;

  const persistence = await verifyPersistence();
  const overall = summarize(metrics.requests, Date.now() - suiteStarted);
  const dbUsage = {
    samples: metrics.dbSamples.length,
    maxTotalConnections: Math.max(0, ...metrics.dbSamples.map((sample) => sample.total)),
    maxActiveConnections: Math.max(0, ...metrics.dbSamples.map((sample) => sample.active)),
    maxWaitingConnections: Math.max(0, ...metrics.dbSamples.map((sample) => sample.waiting)),
  };
  const passed =
    !metrics.circuitBreakerTriggered &&
    overall.errorRatePercent < 1 &&
    overall.p95Ms < 2000 &&
    metrics.sessionLeaks === 0 &&
    persistence.invalidAcceptedSubmissions === 0;
  console.log("LOAD_TEST_REPORT=" + JSON.stringify({
    passed,
    profile: TEST_PROFILE,
    target: BASE_URL,
    overall,
    stages: metrics.stages,
    statusCodes: metrics.statusCodes,
    sessionLeaks: metrics.sessionLeaks,
    circuitBreakerTriggered: metrics.circuitBreakerTriggered,
    dbUsage,
    persistence,
    errors: metrics.errors,
  }));
  await database.end({ timeout: 5 });
  process.exitCode = passed ? 0 : 1;
}

main().catch(async (error) => {
  console.error("Fatal load test failure:", error);
  await database.end({ timeout: 5 }).catch(() => {});
  process.exitCode = 1;
});
