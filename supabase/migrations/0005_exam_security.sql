ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS security_violation_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS security_last_violation_at bigint,
  ADD COLUMN IF NOT EXISTS security_last_violation_reason text,
  ADD COLUMN IF NOT EXISTS security_disqualified_at bigint;

CREATE TABLE IF NOT EXISTS exam_violations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_event_id text NOT NULL UNIQUE,
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  round_id text NOT NULL CHECK (round_id IN ('round1', 'round2')),
  reason text NOT NULL,
  occurred_at bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_violations_participant_time
  ON exam_violations (participant_id, occurred_at DESC);

ALTER TABLE exam_violations ENABLE ROW LEVEL SECURITY;
