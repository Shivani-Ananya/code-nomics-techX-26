-- Migration 0003: Remove Supabase Row Level Security (not needed / blocks local Postgres)
-- Also adds marketplace_items table for the real marketplace
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE rounds DISABLE ROW LEVEL SECURITY;
ALTER TABLE participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers DISABLE ROW LEVEL SECURITY;
ALTER TABLE coding_questions DISABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases DISABLE ROW LEVEL SECURITY;
ALTER TABLE submissions DISABLE ROW LEVEL SECURITY;
ALTER TABLE submission_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE solved_problems DISABLE ROW LEVEL SECURITY;
ALTER TABLE coding_question_scores DISABLE ROW LEVEL SECURITY;
ALTER TABLE help_purchases DISABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE login_rate_limits DISABLE ROW LEVEL SECURITY;
ALTER TABLE score_adjustments DISABLE ROW LEVEL SECURITY;

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
