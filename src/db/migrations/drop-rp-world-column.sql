-- Migration: Remove rp_world column from all tables
-- We're simplifying by using channel_id in metadata instead

-- Drop indexes first
DROP INDEX IF EXISTS idx_rp_archival_world;
DROP INDEX IF EXISTS idx_rp_persona_world;
DROP INDEX IF EXISTS idx_rp_human_world;
DROP INDEX IF EXISTS idx_rp_stm_world;

-- Drop rp_world column from rp_archival_memories
ALTER TABLE rp_archival_memories
DROP COLUMN IF EXISTS rp_world;

-- Drop rp_world column from rp_persona_blocks
ALTER TABLE rp_persona_blocks
DROP COLUMN IF EXISTS rp_world;

-- Drop rp_world column from rp_human_blocks
ALTER TABLE rp_human_blocks
DROP COLUMN IF EXISTS rp_world;

-- Drop rp_world column from rp_stm
ALTER TABLE rp_stm
DROP COLUMN IF EXISTS rp_world;
