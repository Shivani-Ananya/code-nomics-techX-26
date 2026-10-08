import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import postgres from "postgres";

// ── Config ────────────────────────────────────────────────────────────────────
function resolveDatabaseUrl() {
  const value = (
    process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL
  )?.trim();
  if (!value)
    throw new Error("DATABASE_URL is required in the worker environment.");
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

const databaseUrl = resolveDatabaseUrl();
const sslEnabled =
  (process.env.DATABASE_SSL ?? process.env.SUPABASE_DB_SSL) === "true";
const sslMode = sslEnabled ? ("require" as const) : false;
const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY || 4));
const sql = postgres(databaseUrl, {
  max: concurrency + 2,
  prepare: false,
  ssl: sslMode,
});
const workerId = process.env.WORKER_ID || `judge-${process.pid}`;
const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 1000);
const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS || 3);
const timeoutMs = Number(process.env.SANDBOX_TIMEOUT_MS || 10000);
const memoryMb = Number(process.env.SANDBOX_MEMORY_MB || 256);
const cpus = process.env.SANDBOX_CPUS || "0.5";
// On Windows, use temp dir; on Linux use /opt
const workspaceRoot =
  process.env.WORKER_WORKSPACE_ROOT ||
  (process.platform === "win32"
    ? join(tmpdir(), "code-auction-worker")
    : "/opt/code-auction/worker-data");
const pythonImage = process.env.PYTHON_SANDBOX_IMAGE || "python:3.12-slim";
const javaImage =
  process.env.JAVA_SANDBOX_IMAGE || "eclipse-temurin:21-jdk-jammy";

let running = true;
let activeCount = 0;
let databaseHealthy = false;

// ── Types ─────────────────────────────────────────────────────────────────────
type Job = {
  id: string;
  submission_id: string;
  participant_id: string;
  question_id: number;
  language: "Python" | "Java";
  source: string;
  mode: "run" | "submit";
  attempts: number;
};
type TestCase = { input: string; expected_output: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalize = (value: string) =>
  value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trimEnd();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function claim(): Promise<Job | null> {
  const rows = await sql<Job[]>`
    WITH candidate AS (
      SELECT id FROM submission_jobs
      WHERE (status='queued' OR (status='running' AND locked_at < now() - interval '60 seconds'))
        AND attempts < ${maxAttempts}
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE submission_jobs j SET status='running', locked_at=now(), locked_by=${workerId}, attempts=j.attempts+1, updated_at=now()
    FROM candidate WHERE j.id=candidate.id
    RETURNING j.id, j.submission_id, j.participant_id, j.question_id, j.language, j.source, j.mode, j.attempts`;
  return rows[0] ?? null;
}

async function reapExhausted() {
  await sql`
    UPDATE submission_jobs SET status='failed', updated_at=now()
    WHERE status='running' AND attempts >= ${maxAttempts} AND locked_at < now() - interval '120 seconds'`;
}

function runProcess(
  args: string[],
  input: string,
  containerName: string,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "",
      stderr = "",
      finished = false;
    const append = (current: string, data: Buffer) =>
      (current + data.toString("utf8")).slice(0, 1_000_000);
    child.stdout.on("data", (d: Buffer) => {
      stdout = append(stdout, d);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = append(stderr, d);
    });
    child.on("error", (error) => {
      if (!finished) {
        finished = true;
        resolve({ code: -1, stdout, stderr: error.message, timedOut: false });
      }
    });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" }).unref();
      resolve({
        code: -1,
        stdout,
        stderr: "Execution timed out",
        timedOut: true,
      });
    }, timeoutMs);
    child.on("close", (code) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        resolve({ code: code ?? -1, stdout, stderr, timedOut: false });
      }
    });
    child.stdin.end(input);
  });
}

async function execute(job: Job, test: TestCase, sourcePath: string) {
  const name = `ca-${job.id.slice(0, 8)}-${Math.random().toString(16).slice(2, 8)}`;
  const common = [
    "create",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    `${memoryMb}m`,
    "--cpus",
    cpus,
    "--pids-limit",
    "64",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,nosuid,size=96m",
    "--user",
    "65534:65534",
    "-i",
  ];
  const languageArgs =
    job.language === "Python"
      ? [pythonImage, "python", "-I", "/main.py"]
      : [
          javaImage,
          "sh",
          "-lc",
          "mkdir -p /tmp/classes && javac /Main.java -d /tmp/classes && java -cp /tmp/classes Main",
        ];
  try {
    const created = await runProcess([...common, ...languageArgs], "", name);
    if (created.code !== 0) return created;
    const sourceFile = join(
      sourcePath,
      job.language === "Python" ? "main.py" : "Main.java",
    );
    const copied = await runProcess(
      [
        "cp",
        sourceFile,
        `${name}:${job.language === "Python" ? "/main.py" : "/Main.java"}`,
      ],
      "",
      name,
    );
    if (copied.code !== 0) return copied;
    return await runProcess(["start", "-a", "-i", name], test.input, name);
  } finally {
    spawn("docker", ["rm", "-f", name], { stdio: "ignore" }).unref();
  }
}

async function completeRun(
  job: Job,
  result: { code: number; stdout: string; stderr: string; timedOut: boolean },
  expectedOutput: string,
  elapsedMs: number,
) {
  const samplePassed =
    result.code === 0 && normalize(result.stdout) === normalize(expectedOutput);
  const executionOk = result.code === 0 && !result.timedOut;
  await sql.begin(async (tx) => {
    await tx`UPDATE submissions SET verdict=${executionOk ? "ran" : "runtime_error"}, judge_reference=${job.id}, completed_at=${Date.now()} WHERE id=${job.submission_id}`;
    await tx`UPDATE submission_jobs SET status='completed', last_error=NULL,
      result_json=${tx.json({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        timedOut: result.timedOut,
        elapsedMs,
        samplePassed,
        expectedOutput,
        executionOk,
      })}, updated_at=now() WHERE id=${job.id}`;
  });
}

async function complete(job: Job, passed: number, total: number) {
  const accepted = passed === total;
  await sql.begin(async (tx) => {
    const now = Date.now();
    await tx`UPDATE submissions SET passed_count=${passed}, verdict=${accepted ? "accepted" : "failed"}, judge_reference=${job.id}, completed_at=${now} WHERE id=${job.submission_id}`;
    const [question] =
      await tx`SELECT points FROM coding_questions WHERE id=${job.question_id}`;
    const fullPoints = Number(question?.points || 0);
    const submissionScore =
      total > 0 ? Math.floor((fullPoints * passed) / total) : 0;
    const [previous] =
      await tx`SELECT best_passed_count, points_awarded FROM coding_question_scores WHERE participant_id=${job.participant_id} AND question_id=${job.question_id} FOR UPDATE`;
    const previousScore = Number(previous?.points_awarded || 0);
    const bestScore = Math.max(previousScore, submissionScore);
    const scoreDelta = bestScore - previousScore;
    await tx`INSERT INTO coding_question_scores (participant_id, question_id, best_passed_count, total_tests, points_awarded, updated_at)
      VALUES (${job.participant_id}, ${job.question_id}, ${passed}, ${total}, ${submissionScore}, ${now})
      ON CONFLICT (participant_id, question_id) DO UPDATE SET
        best_passed_count=GREATEST(coding_question_scores.best_passed_count, excluded.best_passed_count),
        total_tests=excluded.total_tests,
        points_awarded=GREATEST(coding_question_scores.points_awarded, excluded.points_awarded),
        updated_at=excluded.updated_at`;
    if (scoreDelta > 0)
      await tx`UPDATE participants SET coding_score=coding_score+${scoreDelta} WHERE user_id=${job.participant_id}`;
    if (accepted) {
      const inserted =
        await tx`INSERT INTO solved_problems (participant_id, question_id, solved_at, points_awarded)
        VALUES (${job.participant_id}, ${job.question_id}, ${now}, ${fullPoints})
        ON CONFLICT DO NOTHING RETURNING question_id`;
      if (inserted.length)
        await tx`UPDATE participants SET solved=solved+1, current_question=GREATEST(current_question, ${job.question_id + 1}) WHERE user_id=${job.participant_id}`;
    }
    await tx`UPDATE submission_jobs SET status='completed',
      result_json=${tx.json({ passed, total, accepted, score: submissionScore, bestScore, scoreDelta })},
      last_error=NULL, updated_at=now() WHERE id=${job.id}`;
  });
}

async function failJob(job: Job, error: unknown) {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).slice(0, 1000);
  const terminal = job.attempts >= maxAttempts;
  await sql.begin(async (tx) => {
    await tx`UPDATE submission_jobs SET status=${terminal ? "failed" : "queued"}, locked_at=NULL, locked_by=NULL, last_error=${message}, updated_at=now() WHERE id=${job.id}`;
    if (terminal)
      await tx`UPDATE submissions SET verdict='failed', completed_at=${Date.now()} WHERE id=${job.submission_id}`;
  });
}

async function processJob(job: Job) {
  const directory = join(workspaceRoot, job.id);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, job.language === "Python" ? "main.py" : "Main.java"),
    job.source,
    { encoding: "utf8", mode: 0o444 },
  );
  try {
    if (job.mode === "run") {
      const [question] = await sql<
        { sample_input: string; sample_output: string }[]
      >`
        SELECT sample_input, sample_output FROM coding_questions WHERE id=${job.question_id}`;
      if (!question) throw new Error("Coding question not found");
      const startedAt = Date.now();
      const result = await execute(
        job,
        {
          input: question.sample_input,
          expected_output: question.sample_output,
        },
        directory,
      );
      if ([125, 126, 127, -1].includes(result.code) && !result.timedOut)
        throw new Error(
          `Sandbox unavailable: ${result.stderr || `exit ${result.code}`}`,
        );
      await completeRun(
        job,
        result,
        question.sample_output,
        Date.now() - startedAt,
      );
      return;
    }
    const tests = await sql<
      TestCase[]
    >`SELECT input, expected_output FROM test_cases WHERE question_id=${job.question_id} ORDER BY position`;
    if (!tests.length) throw new Error("No test cases configured");
    let passed = 0;
    for (const [index, test] of tests.entries()) {
      const result = await execute(job, test, directory);
      if (result.timedOut) continue;
      if (
        result.code === 125 ||
        result.code === 126 ||
        result.code === 127 ||
        result.code === -1
      )
        throw new Error(
          `Sandbox unavailable: ${result.stderr || `exit ${result.code}`}`,
        );
      if (
        result.code === 0 &&
        normalize(result.stdout) === normalize(test.expected_output)
      )
        passed++;
      await sql`UPDATE submission_jobs SET
        result_json=${sql.json({ passed, processed: index + 1, total: tests.length })},
        updated_at=now() WHERE id=${job.id}`;
    }
    await complete(job, passed, tests.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

// ── Concurrent worker slots ───────────────────────────────────────────────────
async function workerSlot(slotId: number) {
  let lastReap = 0;
  console.log(`[slot-${slotId}] started`);
  while (running) {
    let job: Job | null = null;
    try {
      if (slotId === 0 && Date.now() - lastReap > 60_000) {
        await reapExhausted();
        lastReap = Date.now();
      }
      job = await claim();
      databaseHealthy = true;
      if (!job) {
        await sleep(pollMs + slotId * 100); // stagger polls
        continue;
      }
      activeCount++;
      console.log(
        `[slot-${slotId}] processing job ${job.id} (${job.language})`,
      );
      await processJob(job);
      console.log(`[slot-${slotId}] completed job ${job.id}`);
    } catch (error) {
      databaseHealthy = false;
      console.error(`[slot-${slotId}] error:`, error);
      try {
        if (job) await failJob(job, error);
        else await sleep(pollMs);
      } catch (recordError) {
        console.error(
          `[slot-${slotId}] could not record job failure`,
          recordError,
        );
        await sleep(pollMs);
      }
    } finally {
      if (job) activeCount = Math.max(0, activeCount - 1);
    }
  }
  console.log(`[slot-${slotId}] stopped`);
}

// ── Health server ─────────────────────────────────────────────────────────────
const healthServer = createServer(async (request, response) => {
  if (request.url === "/health") {
    const [{ queued }] = await sql<
      { queued: number }[]
    >`SELECT count(*)::int AS queued FROM submission_jobs WHERE status IN ('queued','running')`.catch(
      () => [{ queued: -1 }],
    );
    response.statusCode = databaseHealthy ? 200 : 503;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        ok: databaseHealthy,
        workerId,
        active: activeCount,
        queued,
        slots: concurrency,
        database: databaseHealthy ? "connected" : "unavailable",
      }),
    );
  } else {
    response.statusCode = 404;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: "not found" }));
  }
});
healthServer.listen(Number(process.env.WORKER_HEALTH_PORT || 9091), "0.0.0.0");
console.log(
  `Judge worker started: ${concurrency} concurrent slots, health on :${process.env.WORKER_HEALTH_PORT || 9091}`,
);

// ── Start all slots ───────────────────────────────────────────────────────────
const slots = Array.from({ length: concurrency }, (_, i) => workerSlot(i));

const shutdown = () => {
  console.log("Shutting down worker…");
  running = false;
  healthServer.close();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await Promise.all(slots);
await sql.end({ timeout: 5 });
