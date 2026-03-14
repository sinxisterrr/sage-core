-- Clean Schema - 3 Tables Only
-- For scorched earth fresh start with embeddings

--======================================================================
-- Table 1: Archival Memories (from /data/archival_memories.json)
--======================================================================

CREATE TABLE IF NOT EXISTS archival_memories (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT 'DEFAULT',
  content TEXT NOT NULL,
  category TEXT,
  importance INTEGER DEFAULT 5,
  timestamp BIGINT,
  tags JSONB DEFAULT '[]'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Embedding support
  embedding JSONB DEFAULT NULL,
  last_embedded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_archival_bot ON archival_memories(bot_id);
CREATE INDEX idx_archival_importance ON archival_memories(importance DESC);
CREATE INDEX idx_archival_timestamp ON archival_memories(timestamp DESC);
CREATE INDEX idx_archival_tags ON archival_memories USING GIN(tags);
CREATE INDEX idx_archival_embedding ON archival_memories(bot_id) WHERE embedding IS NOT NULL;

--======================================================================
-- Table 2 & 3: Memory Blocks (human + persona)
--======================================================================

CREATE TABLE IF NOT EXISTS memory_blocks (
  id SERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL DEFAULT 'DEFAULT',
  label TEXT NOT NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('human', 'persona')),
  content TEXT NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  limit_value INTEGER,
  read_only BOOLEAN DEFAULT false,

  -- Embedding support
  embedding JSONB DEFAULT NULL,
  last_embedded_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(bot_id, label, block_type)
);

CREATE INDEX idx_blocks_bot ON memory_blocks(bot_id);
CREATE INDEX idx_blocks_type ON memory_blocks(bot_id, block_type);
CREATE INDEX idx_blocks_embedding ON memory_blocks(bot_id) WHERE embedding IS NOT NULL;

--======================================================================
-- That's it! Just 3 tables for memory storage.
-- Everything else (STM, compression, identity) happens in-memory.
--======================================================================
