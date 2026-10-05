# TECHX Madras 26 Code Auction

Production architecture for the live code-auction event:

- Next.js runs the UI and authenticated API on Vercel.
- Supabase Postgres is the authoritative store for accounts, rounds, scores, submissions, audit records, and the durable judge queue.
- One EC2 worker atomically claims queued submissions and executes Python 3.12 or Java 21 inside restricted Docker containers.
- Participant browsers only talk to Next.js. They never receive database credentials or reach the executor directly.

Cloudflare, Vinext, D1, Wrangler, and Judge0 are not used.

## Local web app

Requirements: Node.js 22 and a Supabase project.

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

The development URL is `http://127.0.0.1:5173`. A normal production `next start` uses port 3000 unless `PORT` is set.

The first authenticated request seeds `HOST-01` and participants `CA-1001` through `CA-1010`. Both event passwords must be at least 12 characters. Use distinct, randomly generated production passwords.

## Required Vercel variables

- `SUPABASE_DATABASE_URL`: Supabase pooler connection string. Use the transaction pooler on port 6543 for serverless functions.
- `SUPABASE_DB_SSL=true`
- `DATABASE_POOL_SIZE=5`
- `SESSION_SECRET`: at least 32 random bytes.
- `EVENT_HOST_PASSWORD`
- `EVENT_PARTICIPANT_PASSWORD`
- `JUDGE_QUEUE_ENABLED=true`

Run `npm run db:migrate` from a trusted machine before the first deployment, then import the repository in Vercel. `vercel.json` selects Next.js and the normal build command.

## EC2 judge worker

Use a dedicated Ubuntu EC2 instance with Docker Engine and Docker Compose. The worker is intentionally single-concurrency for a micro instance. Java compilation can be memory-heavy; if event load is more than a few simultaneous submissions, use at least a `t3.small`.

```bash
sudo mkdir -p /opt/code-auction/worker-data
sudo chown -R "$USER":"$USER" /opt/code-auction
cp .env.worker.example .env.worker
docker pull python:3.12-slim
docker pull eclipse-temurin:21-jdk-jammy
docker compose -f docker-compose.worker.yml up -d --build
curl http://127.0.0.1:9091/health
```

Only SSH from an administrator IP should be allowed inbound. Port 9091 is bound to loopback. The worker needs outbound TLS to Supabase and access to the local Docker socket.

Each sandbox receives:

- no network access;
- a read-only filesystem and read-only source mount;
- a non-root user;
- dropped Linux capabilities and `no-new-privileges`;
- CPU, memory, process, output, and wall-time limits.

Mounting the Docker socket gives the worker control of Docker on that EC2 host. Keep the host dedicated to judging, patch it regularly, and do not store unrelated secrets there.

## Queue behavior

Submitting code creates a `submissions` record and a `submission_jobs` row in one database transaction. The worker claims one job with `FOR UPDATE SKIP LOCKED`, so multiple workers may be added later without processing the same job twice. Abandoned running jobs are reclaimed after 60 seconds. Infrastructure failures retry up to `WORKER_MAX_ATTEMPTS`; ordinary wrong answers complete normally. Score awards and job completion are committed in one transaction and solved problems are unique per participant/question.

The web app polls the central state every two seconds during active rounds and shows `queued`, `running`, or the final test result. The host retains an audited manual score override for emergency recovery.

## Commands and ports

| Component | Command | Port |
|---|---|---|
| Next.js development | `npm run dev` | 5173 |
| Next.js production (local) | `npm run build && npm start` | 3000 |
| Judge worker health | `npm run worker:build && npm run worker:start` | 9091 |

Health endpoints:

- Web/database/queue: `/api/health`
- Worker: `http://127.0.0.1:9091/health`

## Production checklist

1. Create Supabase, restrict database credentials, enable backups, and run migrations.
2. Deploy Vercel with production environment variables and verify `/api/health`.
3. Launch the dedicated EC2 worker and verify its health endpoint and logs.
4. Submit one Python and one Java solution in a staging round.
5. Confirm test results, score updates, retry behavior, logout, account lock, and manual override.
6. Rotate event passwords and `SESSION_SECRET` after the event.
