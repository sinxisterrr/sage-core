-- Migration: Add heartbeat_themes table
-- Stores recent heartbeat themes to prevent repetition
-- Replaces heartbeat_themes.json file for Railway compatibility

CREATE TABLE IF NOT EXISTS heartbeat_themes (
  id SERIAL PRIMARY KEY,
  theme VARCHAR(100) NOT NULL,
  anchor_words TEXT[] NOT NULL,
  emotional_category VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups of recent themes
CREATE INDEX IF NOT EXISTS idx_heartbeat_themes_created_at ON heartbeat_themes(created_at DESC);

-- Cleanup old themes (keep only last 20, buffer beyond the needed 10)
-- This prevents table bloat over time
CREATE OR REPLACE FUNCTION cleanup_old_heartbeat_themes()
RETURNS void AS $$
BEGIN
  DELETE FROM heartbeat_themes
  WHERE id NOT IN (
    SELECT id FROM heartbeat_themes
    ORDER BY created_at DESC
    LIMIT 20
  );
END;
$$ LANGUAGE plpgsql;
