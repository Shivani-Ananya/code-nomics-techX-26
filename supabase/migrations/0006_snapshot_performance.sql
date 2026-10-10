CREATE INDEX IF NOT EXISTS idx_users_participant_name
  ON users (name)
  WHERE role='participant';
