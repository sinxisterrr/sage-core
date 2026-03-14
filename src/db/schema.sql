-- Continuum Memory System Schema
-- ONLY these 4 tables - no legacy tables
-- Using pgvector for maximum semantic search "texture"

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Table: archival_memories (Long-term memories from archived conversations)
CREATE TABLE IF NOT EXISTS archival_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance INTEGER NOT NULL,
  timestamp BIGINT,
  tags JSONB DEFAULT '[]'::jsonb,
  message_weight NUMERIC,
  mira_type TEXT,
  embedding vector(1024),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: persona_blocks (AI identity and understanding)
CREATE TABLE IF NOT EXISTS persona_blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  mira_type TEXT,
  average_weight NUMERIC,
  min_weight NUMERIC,
  max_weight NUMERIC,
  message_count INTEGER,
  embedding vector(1024),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: human_blocks (User identity and information)
CREATE TABLE IF NOT EXISTS human_blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  mira_type TEXT,
  average_weight NUMERIC,
  min_weight NUMERIC,
  max_weight NUMERIC,
  message_count INTEGER,
  embedding vector(1024),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: stm (Short-term memory buffer - persisted for crash recovery)
CREATE TABLE IF NOT EXISTS stm (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_archival_weight ON archival_memories(message_weight DESC);
CREATE INDEX IF NOT EXISTS idx_archival_tags ON archival_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_archival_importance ON archival_memories(importance DESC);

CREATE INDEX IF NOT EXISTS idx_persona_blocks_weight ON persona_blocks(average_weight DESC);
CREATE INDEX IF NOT EXISTS idx_human_blocks_weight ON human_blocks(average_weight DESC);

CREATE INDEX IF NOT EXISTS idx_stm_user_timestamp ON stm(user_id, timestamp DESC);

-- ============================================================
-- ROLEPLAY MEMORY SYSTEM
-- Separate tables for RP channels (narrative, not real life)
-- ============================================================

-- Table: rp_archival_memories (RP conversation archives)
CREATE TABLE IF NOT EXISTS rp_archival_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance INTEGER NOT NULL,
  timestamp BIGINT,
  tags JSONB DEFAULT '[]'::jsonb,
  message_weight NUMERIC,
  mira_type TEXT,
  embedding vector(1024),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: rp_persona_blocks (How AI acts in RPs - narrative context)
CREATE TABLE IF NOT EXISTS rp_persona_blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  mira_type TEXT,
  average_weight NUMERIC,
  min_weight NUMERIC,
  max_weight NUMERIC,
  message_count INTEGER,
  embedding vector(1024),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: rp_human_blocks (How user acts in RPs - narrative context)
CREATE TABLE IF NOT EXISTS rp_human_blocks (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  mira_type TEXT,
  average_weight NUMERIC,
  min_weight NUMERIC,
  max_weight NUMERIC,
  message_count INTEGER,
  embedding vector(1024),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Table: rp_stm (RP Short-term memory buffer)
CREATE TABLE IF NOT EXISTS rp_stm (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for RP tables
CREATE INDEX IF NOT EXISTS idx_rp_archival_weight ON rp_archival_memories(message_weight DESC);
CREATE INDEX IF NOT EXISTS idx_rp_archival_tags ON rp_archival_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_rp_archival_importance ON rp_archival_memories(importance DESC);

CREATE INDEX IF NOT EXISTS idx_rp_persona_blocks_weight ON rp_persona_blocks(average_weight DESC);
CREATE INDEX IF NOT EXISTS idx_rp_human_blocks_weight ON rp_human_blocks(average_weight DESC);

CREATE INDEX IF NOT EXISTS idx_rp_stm_user_timestamp ON rp_stm(user_id, timestamp DESC);

-- ============================================================
-- REFERENCE TEXT SYSTEM
-- Load .txt files from /data for AI reference
-- ============================================================

-- Table: reference_texts (Text paragraphs from .txt files)
CREATE TABLE IF NOT EXISTS reference_texts (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  paragraph_number INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1024),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for reference texts
CREATE INDEX IF NOT EXISTS idx_reference_source ON reference_texts(source_file);

-- NOTE: Vector similarity indexes (ivfflat) are created in the background
-- after bot startup to avoid blocking initialization.
-- See: buildVectorIndexes() in src/db/init.ts
