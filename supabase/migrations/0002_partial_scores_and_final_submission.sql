ALTER TABLE participants
  ADD COLUMN IF NOT EXISTS coding_submitted_at bigint;

CREATE TABLE IF NOT EXISTS coding_question_scores (
  participant_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id integer NOT NULL REFERENCES coding_questions(id) ON DELETE CASCADE,
  best_passed_count integer NOT NULL DEFAULT 0,
  total_tests integer NOT NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL,
  PRIMARY KEY (participant_id, question_id)
);

INSERT INTO coding_question_scores (
  participant_id,
  question_id,
  best_passed_count,
  total_tests,
  points_awarded,
  updated_at
)
SELECT
  solved.participant_id,
  solved.question_id,
  test_totals.total_tests,
  test_totals.total_tests,
  solved.points_awarded,
  solved.solved_at
FROM solved_problems solved
JOIN (
  SELECT question_id, count(*)::int AS total_tests
  FROM test_cases
  GROUP BY question_id
) test_totals ON test_totals.question_id = solved.question_id
ON CONFLICT (participant_id, question_id) DO NOTHING;

ALTER TABLE coding_question_scores ENABLE ROW LEVEL SECURITY;
