import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) throw new Error("SUPABASE_DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 2, prepare: false, ssl: process.env.SUPABASE_DB_SSL === "false" ? false : "require" });
const workerId = process.env.WORKER_ID || `judge-${process.pid}`;
const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS || 1000);
const maxAttempts = Number(process.env.WORKER_MAX_ATTEMPTS || 3);
const timeoutMs = Number(process.env.SANDBOX_TIMEOUT_MS || 8000);
const memoryMb = Number(process.env.SANDBOX_MEMORY_MB || 256);
const cpus = process.env.SANDBOX_CPUS || "0.5";
const workspaceRoot = process.env.WORKER_WORKSPACE_ROOT || "/opt/code-auction/worker-data";
const pythonImage = process.env.PYTHON_SANDBOX_IMAGE || "python:3.12-slim";
const javaImage = process.env.JAVA_SANDBOX_IMAGE || "eclipse-temurin:21-jdk-jammy";
let running = true;
let active = false;
let databaseHealthy = false;

type Job = { id: string; submission_id: string; participant_id: string; question_id: number; language: "Python" | "Java"; source: string; attempts: number };
type TestCase = { input: string; expected_output: string };

const normalize = (value: string) => value.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
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
    FROM candidate c WHERE j.id=c.id
    RETURNING j.id, j.submission_id, j.participant_id, j.question_id, j.language, j.source, j.attempts`;
  return rows[0] || null;
}

async function reapExhausted() {
  await sql.begin(async (tx) => {
    const stale = await tx<{ submission_id: string }[]>`UPDATE submission_jobs SET status='failed', locked_at=NULL, locked_by=NULL, last_error='Worker stopped during the final retry', updated_at=now() WHERE status='running' AND attempts >= ${maxAttempts} AND locked_at < now() - interval '60 seconds' RETURNING submission_id`;
    if (stale.length) await tx`UPDATE submissions SET verdict='failed', completed_at=${Date.now()} WHERE id IN ${tx(stale.map((row) => row.submission_id))}`;
  });
}

function runProcess(args: string[], input: string, containerName: string) {
  return new Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", finished = false;
    const append = (current: string, data: Buffer) => (current + data.toString("utf8")).slice(0, 1_000_000);
    child.stdout.on("data", (d: Buffer) => { stdout = append(stdout, d); });
    child.stderr.on("data", (d: Buffer) => { stderr = append(stderr, d); });
    child.on("error", (error) => { if (!finished) { finished = true; resolve({ code: -1, stdout, stderr: error.message, timedOut: false }); } });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      spawn("docker", ["rm", "-f", containerName], { stdio: "ignore" }).unref();
      resolve({ code: -1, stdout, stderr: "Execution timed out", timedOut: true });
    }, timeoutMs);
    child.on("close", (code) => { if (!finished) { finished = true; clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr, timedOut: false }); } });
    child.stdin.end(input);
  });
}

async function execute(job: Job, test: TestCase, sourcePath: string) {
  const name = `code-auction-${job.id.slice(0, 8)}-${Math.random().toString(16).slice(2, 8)}`;
  const common = ["run", "--rm", "--name", name, "--network", "none", "--memory", `${memoryMb}m`, "--cpus", cpus, "--pids-limit", "64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--tmpfs", "/tmp:rw,nosuid,size=96m", "--user", "65534:65534", "-i", "-v", `${sourcePath}:/workspace:ro`];
  const languageArgs = job.language === "Python"
    ? [pythonImage, "python", "-I", "/workspace/main.py"]
    : [javaImage, "sh", "-lc", "mkdir -p /tmp/classes && javac /workspace/Main.java -d /tmp/classes && java -cp /tmp/classes Main"];
  return runProcess([...common, ...languageArgs], test.input, name);
}

async function complete(job: Job, passed: number, total: number) {
  const accepted = passed === total;
  await sql.begin(async (tx) => {
    const now = Date.now();
    await tx`UPDATE submissions SET passed_count=${passed}, verdict=${accepted ? "accepted" : "failed"}, judge_reference=${job.id}, completed_at=${now} WHERE id=${job.submission_id}`;
    if (accepted) {
      const [question] = await tx`SELECT points FROM coding_questions WHERE id=${job.question_id}`;
      const inserted = await tx`INSERT INTO solved_problems (participant_id, question_id, solved_at, points_awarded) VALUES (${job.participant_id}, ${job.question_id}, ${now}, ${Number(question?.points || 0)}) ON CONFLICT DO NOTHING RETURNING question_id`;
      if (inserted.length) await tx`UPDATE participants SET solved=solved+1, coding_score=coding_score+${Number(question?.points || 0)}, current_question=LEAST(5,current_question+1), completion_time=CASE WHEN current_question=5 THEN ${now} ELSE completion_time END WHERE user_id=${job.participant_id}`;
    }
    await tx`UPDATE submission_jobs SET status='completed', result_json=${tx.json({ passed, total, accepted })}, last_error=NULL, updated_at=now() WHERE id=${job.id}`;
  });
}

async function failJob(job: Job, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const terminal = job.attempts >= maxAttempts;
  await sql.begin(async (tx) => {
    await tx`UPDATE submission_jobs SET status=${terminal ? "failed" : "queued"}, locked_at=NULL, locked_by=NULL, last_error=${message}, updated_at=now() WHERE id=${job.id}`;
    if (terminal) await tx`UPDATE submissions SET verdict='failed', completed_at=${Date.now()} WHERE id=${job.submission_id}`;
  });
}

async function processJob(job: Job) {
  const directory = join(workspaceRoot, job.id);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, job.language === "Python" ? "main.py" : "Main.java"), job.source, { encoding: "utf8", mode: 0o444 });
  try {
    const tests = await sql<TestCase[]>`SELECT input, expected_output FROM test_cases WHERE question_id=${job.question_id} ORDER BY position`;
    if (!tests.length) throw new Error("No test cases configured");
    let passed = 0;
    for (const test of tests) {
      const result = await execute(job, test, directory);
      if (result.timedOut) continue;
      if (result.code === 125 || result.code === 126 || result.code === 127 || result.code === -1) throw new Error(`Sandbox unavailable: ${result.stderr || `exit ${result.code}`}`);
      if (result.code === 0 && normalize(result.stdout) === normalize(test.expected_output)) passed++;
    }
    await complete(job, passed, tests.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function loop() {
  await mkdir(workspaceRoot, { recursive: true });
  let lastReap = 0;
  while (running) {
    let job: Job | null = null;
    try {
      if (Date.now() - lastReap > 60_000) { await reapExhausted(); lastReap = Date.now(); }
      job = await claim();
      databaseHealthy = true;
      if (!job) { await sleep(pollMs); continue; }
      active = true;
      await processJob(job);
    } catch (error) {
      databaseHealthy = false;
      console.error(error);
      try {
        if (job) await failJob(job, error);
        else await sleep(pollMs);
      } catch (recordError) {
        console.error("Could not record job failure", recordError);
        await sleep(pollMs);
      }
    } finally { active = false; }
  }
  await sql.end({ timeout: 5 });
}

const healthServer = createServer((request, response) => {
  response.statusCode = request.url === "/health" ? (databaseHealthy ? 200 : 503) : 404;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(request.url === "/health" ? { ok: databaseHealthy, workerId, active, database: databaseHealthy ? "connected" : "unavailable" } : { error: "not found" }));
});
healthServer.listen(Number(process.env.WORKER_HEALTH_PORT || 9091), "0.0.0.0");

const shutdown = () => { running = false; healthServer.close(); };
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
void loop();
