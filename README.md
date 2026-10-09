# TECHX Madras 26 Code Auction

The recommended event-day architecture is fully local and works without internet:

- Docker runs Next.js, PostgreSQL, and a four-slot judge worker on the host laptop.
- PostgreSQL stores accounts, rounds, scores, submissions, and the durable Run/Submit queue.
- Python 3.12 and Java 21 code execute inside isolated, resource-limited Docker containers.
- Participant browsers connect to the laptop over the venue LAN and never receive database credentials or reach Docker directly.

## Quick Start: How to Run the Platform & Share with Participants

### Part 1: How to Run the Platform

You have **two main ways** to run this platform:

#### Option A: Cloud Hosting (Recommended for Online Events)
Deploy the web app for free on **Vercel** and use **Supabase** for the database:

1. **Database Setup (Supabase)**:
   - Go to [Supabase](https://supabase.com/), create a project, and copy its **Transaction pooler** connection string as `DATABASE_URL`. Use port `6543`; do not use the public API URL or publishable key as a database connection.
   - Run database migrations locally or via terminal:
     ```bash
     npm run db:migrate
     ```

2. **Web App Deployment (Vercel)**:
   - Go to [Vercel](https://vercel.com/) and click **"Add New" ➔ "Project"**.
   - Import your GitHub repo: `Shivani-Ananya/code-nomics-techX-26`.
   - In **Environment Variables**, add:
     - `DATABASE_URL`: Your Supabase transaction-pooler URL (port `6543`).
     - `DATABASE_SSL`: `true`
     - `DATABASE_POOL_SIZE`: `5`
     - `SESSION_SECRET`: A random secret string (at least 32 characters).
     - `EVENT_HOST_PASSWORD`: Your secret admin host password.
     - `JUDGE_QUEUE_ENABLED`: `true`
   - Click **Deploy**. Vercel will give you a live URL (e.g. `https://your-app.vercel.app`).

#### Option B: Offline Local LAN Deployment (For In-Person Events)
If you are hosting an offline event at a venue without reliable internet:

1. Open PowerShell in the project directory on your host laptop and run:
   ```powershell
   .\prepare-offline.ps1
   ```
2. On event day, start the event:
   ```powershell
   .\start-event.ps1
   ```
3. The script will start Docker containers (Next.js web app, Postgres DB, and Code Judge Worker) and display your laptop's LAN IP address (e.g., `http://192.168.1.15:3000`).

---

### Part 2: How to Give It to Participants

1. **Share the Link / URL**:
   - **For Cloud**: Share your Vercel deployment URL (e.g. `https://your-app.vercel.app`).
   - **For Local LAN**: Connect all participant laptops to the same Wi-Fi/router and share your host IP (e.g. `http://192.168.1.X:3000`).

2. **Login & Account Distribution**:
   - Log into the app as Host (`HOST-01`) using your `EVENT_HOST_PASSWORD`.
   - Go to the **Host Control Room / Dashboard**.
   - **Create Teams**: You can add team names individually or paste a list of team names in bulk.
   - **Credentials**: The team name acts as both the **Username** and initial **Password** for that participant!
     - *Example:* If you create a team called `TechTitans`, the login credentials for that team are:
       - **Username**: `TechTitans`
       - **Password**: `TechTitans`
   - Hand out the assigned team names to each team/participant group.

---

## Architecture Overview

The event platform supports both fully local offline operation and cloud serverless architecture:

Requirements: Windows 10/11, Docker Desktop with Linux containers, Node.js 22, and at least 8 GB RAM (16 GB recommended for 100+ participants).

While internet is available, run this once from PowerShell:

```powershell
.\prepare-offline.ps1
```

This downloads PostgreSQL, Python, and Java, builds the two application images, generates strong local secrets, and writes the host login to `offline-credentials.txt`. After it completes, disconnecting the internet is safe.

On event day:

```powershell
.\start-event.ps1
```

The host opens `http://localhost:3000`. The script also prints the LAN address participants should open. Allow inbound TCP port 3000 in Windows Firewall on the private venue network. Stop the services without deleting event data using `.\stop-event.ps1`; view health and recent logs with `.\status-event.ps1`.

PostgreSQL persists in a named Docker volume. `docker compose down` preserves it; adding `-v` deletes all event data and should only be used for an intentional full reset.

### Coding workflow and capacity

Run and Submit both use the durable PostgreSQL queue; web requests never start compilers directly. Four fixed worker slots prevent a rush of 100+ participants from spawning unlimited processes. Each execution has CPU, memory, process, network, output, and time limits.

Participants first choose **Run**. The console displays real stdout, stderr, timeout, exit status, and sample comparison. A scored **Submit** is accepted only after that exact source code has run successfully. During hidden judging, the UI shows how many tests have passed and how many have been processed. Partial points are stored as the best score for each question, so retries cannot reduce a score or farm duplicate points.

## Local web app

For source development without the full Docker stack, use Node.js 22 and PostgreSQL.

```bash
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

The development URL is `http://127.0.0.1:5173`. The offline Docker site uses port 3000 and local PostgreSQL uses loopback port 5433.

The first authenticated request creates only the `HOST-01` account and the default question bank. Participant teams are created by the host from the control room, individually or in bulk. Participants use their team name as both the login username and initial password. Internal IDs begin at `CA-1001` and are retained only for scoring and database relationships.

### Host-managed event data

The host control room can add one team or paste one team name per line for bulk creation. Team names are deduplicated case-insensitively, the next internal `CA-` ID is assigned automatically, and the team-name username/password is shown immediately so it can be distributed. Passwords are case-sensitive. Existing teams are never silently replaced; use the per-team remove action or the confirmed **Remove all current teams** action when intentionally resetting an event.

Coding questions can also be added individually or as a bulk JSON array. Each bulk item uses this shape:

```json
{
  "title": "Count vowels",
  "difficulty": "EASY",
  "points": 300,
  "statement": "Read a string and print its vowel count.",
  "inputFormat": "One line of text",
  "outputFormat": "One integer",
  "sampleInput": "hello world",
  "sampleOutput": "3",
  "hints": ["Check each character"],
  "tests": [{ "input": "hello world", "expectedOutput": "3" }]
}
```

Every question must contain at least one hidden test. The host dashboard also provides dedicated views for all, locked, and disqualified teams.

## Accounts and passwords

Before the first database seed, set `EVENT_HOST_PASSWORD` in `.env.local` for local development and in Vercel Project Settings → Environment Variables for production. Restart the local server after editing `.env.local`.

Once accounts exist, changing those environment variables does not overwrite their passwords. Reset an existing account from PowerShell with:

```powershell
$env:NEW_PASSWORD="replace-with-a-secure-password"
npm run password:set -- --id HOST-01
# Or reset every currently registered participant to one password:
npm run password:set -- --all-participants
Remove-Item Env:NEW_PASSWORD
```

Use an individual participant ID instead of `--all-participants` to reset only that participant, for example `npm run password:set -- --id CA-1001`.

## Required Vercel variables

- `DATABASE_URL`: Supabase transaction-pooler connection string. Use port 6543 for Vercel serverless functions. This is a server-only secret.
- `DATABASE_SSL=true`
- `DATABASE_POOL_SIZE=5`
- `SESSION_SECRET`: at least 32 random bytes.
- `EVENT_HOST_PASSWORD`: at least 12 characters; used only when the initial `HOST-01` record is created.
- `JUDGE_QUEUE_ENABLED=true`: enable only after a judge worker connected to the same database is healthy.

`SUPABASE_DATABASE_URL` and `SUPABASE_DB_SSL` remain accepted as legacy aliases, but new deployments should use the canonical names above. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are not database credentials and are not used by the current server-side PostgreSQL data layer.

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

| Component                  | Command                                        | Port |
| -------------------------- | ---------------------------------------------- | ---- |
| Next.js development        | `npm run dev`                                  | 5173 |
| Next.js production (local) | `npm run build && npm start`                   | 3000 |
| Judge worker health        | `npm run worker:build && npm run worker:start` | 9091 |

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
