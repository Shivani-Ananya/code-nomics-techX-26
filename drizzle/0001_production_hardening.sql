CREATE TABLE login_rate_limits (
  client_key text PRIMARY KEY NOT NULL,
  failed_count integer DEFAULT 0 NOT NULL,
  first_failed_at integer NOT NULL,
  blocked_until integer,
  updated_at integer NOT NULL
);
CREATE INDEX idx_login_rate_limits_updated ON login_rate_limits (updated_at);

CREATE TABLE score_adjustments (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  participant_id text NOT NULL,
  host_id text NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  score_before integer NOT NULL,
  score_after integer NOT NULL,
  created_at integer NOT NULL,
  FOREIGN KEY (participant_id) REFERENCES users(id) ON DELETE cascade,
  FOREIGN KEY (host_id) REFERENCES users(id)
);
CREATE INDEX idx_score_adjustments_participant_created ON score_adjustments (participant_id, created_at);
