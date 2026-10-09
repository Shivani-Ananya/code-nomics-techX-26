-- Shared schema additions used by both Supabase and local PostgreSQL.
--
-- Keep Row Level Security enabled. The web application and judge worker use a
-- trusted server-side PostgreSQL connection, while Supabase public roles must
-- not be able to access event data directly. Local PostgreSQL table owners
-- bypass RLS, so the offline Docker deployment remains functional.

-- Add run_output column to submissions for storing sample-run results
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS run_output text;

-- Add queue_position view for participants to see their position
CREATE OR REPLACE VIEW submission_queue_view AS
SELECT
  j.participant_id,
  j.id AS job_id,
  j.status,
  j.created_at,
  ROW_NUMBER() OVER (
    PARTITION BY j.status
    ORDER BY j.created_at
  ) AS position_in_status
FROM submission_jobs j
WHERE j.status IN ('queued', 'running');
