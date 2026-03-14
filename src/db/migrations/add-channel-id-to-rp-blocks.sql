-- Migration: Add channel_id to RP persona and human blocks for per-channel isolation
-- This ensures each RP channel has its own personality patterns
-- Date: 2026-01-21

-- Add channel_id column to rp_persona_blocks
ALTER TABLE rp_persona_blocks
ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- Add channel_id column to rp_human_blocks
ALTER TABLE rp_human_blocks
ADD COLUMN IF NOT EXISTS channel_id TEXT;

-- Create indexes for efficient channel-filtered queries
CREATE INDEX IF NOT EXISTS idx_rp_persona_channel ON rp_persona_blocks(channel_id);
CREATE INDEX IF NOT EXISTS idx_rp_human_channel ON rp_human_blocks(channel_id);

-- Note: Existing blocks without channel_id will return NULL and won't match channel filters
-- This is intentional - they'll be orphaned and new channel-specific blocks will be created
