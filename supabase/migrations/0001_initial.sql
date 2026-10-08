CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('host', 'participant')),
  name text NOT NULL,
  college text,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  disqualified boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL
);
CREATE INDEX idx_users_role ON users (role);

CREATE TABLE rounds (
  id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'paused', 'ended')),
  duration_seconds integer NOT NULL,
  started_at bigint,
  paused_at bigint,
  accumulated_pause_seconds integer NOT NULL DEFAULT 0,
  results_published boolean NOT NULL DEFAULT false,
  updated_at bigint NOT NULL
);

CREATE TABLE participants (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quiz_submitted_at bigint,
  quiz_correct integer NOT NULL DEFAULT 0,
  coins integer NOT NULL DEFAULT 0,
  coding_score integer NOT NULL DEFAULT 0,
  language text CHECK (language IN ('Python', 'Java')),
  current_question integer NOT NULL DEFAULT 1,
  solved integer NOT NULL DEFAULT 0,
  helps_used integer NOT NULL DEFAULT 0,
  completion_time bigint,
  coding_submitted_at bigint,
  status text NOT NULL DEFAULT 'waiting',
  last_seen bigint NOT NULL
);

CREATE TABLE quiz_questions (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
  prompt text NOT NULL,
  options_json jsonb NOT NULL,
  correct_index integer NOT NULL,
  coin_value integer NOT NULL
);

CREATE TABLE quiz_answers (
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  answer_index integer NOT NULL,
  answered_at bigint NOT NULL,
  PRIMARY KEY (participant_id, question_id)
);
CREATE INDEX idx_quiz_answers_participant ON quiz_answers (participant_id);

CREATE TABLE coding_questions (
  id integer PRIMARY KEY,
  title text NOT NULL,
  difficulty text NOT NULL,
  points integer NOT NULL,
  statement text NOT NULL,
  input_format text NOT NULL,
  output_format text NOT NULL,
  sample_input text NOT NULL,
  sample_output text NOT NULL,
  hints_json jsonb NOT NULL
);

CREATE TABLE test_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_id integer NOT NULL REFERENCES coding_questions(id) ON DELETE CASCADE,
  input text NOT NULL,
  expected_output text NOT NULL,
  position integer NOT NULL,
  UNIQUE (question_id, position)
);

CREATE TABLE submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id),
  language text NOT NULL,
  source text NOT NULL,
  passed_count integer NOT NULL DEFAULT 0,
  verdict text NOT NULL,
  judge_reference text,
  created_at bigint NOT NULL,
  completed_at bigint
);
CREATE INDEX idx_submissions_participant_created ON submissions (participant_id, created_at DESC);

CREATE TABLE submission_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id bigint NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id),
  language text NOT NULL CHECK (language IN ('Python', 'Java')),
  source text NOT NULL,
  mode text NOT NULL DEFAULT 'submit' CHECK (mode IN ('run', 'submit')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_submission_jobs_claim ON submission_jobs (status, created_at);
CREATE INDEX idx_submission_jobs_participant ON submission_jobs (participant_id, created_at DESC);

CREATE TABLE solved_problems (
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id),
  solved_at bigint NOT NULL,
  points_awarded integer NOT NULL,
  PRIMARY KEY (participant_id, question_id)
);

CREATE TABLE coding_question_scores (
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id) ON DELETE CASCADE,
  best_passed_count integer NOT NULL DEFAULT 0,
  total_tests integer NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL,
  PRIMARY KEY (participant_id, question_id)
);

CREATE TABLE help_purchases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id),
  kind text NOT NULL,
  cost integer NOT NULL,
  language text NOT NULL,
  content text NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX idx_help_participant ON help_purchases (participant_id);

CREATE TABLE coin_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  description text NOT NULL,
  balance_before integer NOT NULL,
  amount integer NOT NULL,
  balance_after integer NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX idx_coin_transactions_participant_created ON coin_transactions (participant_id, created_at DESC);

CREATE TABLE login_rate_limits (
  client_key text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  first_failed_at bigint NOT NULL,
  blocked_until bigint,
  updated_at bigint NOT NULL
);
CREATE INDEX idx_login_rate_limits_updated ON login_rate_limits (updated_at);

CREATE TABLE score_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  host_id text NOT NULL REFERENCES users(id),
  delta integer NOT NULL,
  reason text NOT NULL,
  score_before integer NOT NULL,
  score_after integer NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX idx_score_adjustments_participant_created ON score_adjustments (participant_id, created_at DESC);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE solved_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE coding_question_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE help_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE coin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE score_adjustments ENABLE ROW LEVEL SECURITY;
