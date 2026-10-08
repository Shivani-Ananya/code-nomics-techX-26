-- Queue sample runs as well as scored submissions. Keeping both workloads in
-- one durable queue prevents web requests from spawning unbounded sandboxes.
ALTER TABLE submission_jobs
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'submit';

ALTER TABLE submission_jobs
  DROP CONSTRAINT IF EXISTS submission_jobs_mode_check;

ALTER TABLE submission_jobs
  ADD CONSTRAINT submission_jobs_mode_check CHECK (mode IN ('run', 'submit'));

CREATE INDEX IF NOT EXISTS idx_submission_jobs_participant_mode
  ON submission_jobs (participant_id, mode, created_at DESC);
