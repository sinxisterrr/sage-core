#!/usr/bin/env tsx
//--------------------------------------------------------------
// Reset Continuum Memory Tables
// Drops and recreates persona_blocks, human_blocks, archival_memories
//--------------------------------------------------------------

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function resetTables() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log('🔥 Dropping existing continuum tables...');

    // Drop tables
    await client.query('DROP TABLE IF EXISTS persona_blocks CASCADE');
    await client.query('DROP TABLE IF EXISTS human_blocks CASCADE');
    await client.query('DROP TABLE IF EXISTS archival_memories CASCADE');

    console.log('✅ Tables dropped');

    console.log('🔧 Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');

    console.log('📦 Creating persona_blocks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS persona_blocks (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        mira_type TEXT,
        average_weight NUMERIC,
        min_weight NUMERIC,
        max_weight NUMERIC,
        message_count INTEGER,
        embedding vector(384),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('📦 Creating human_blocks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS human_blocks (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        mira_type TEXT,
        average_weight NUMERIC,
        min_weight NUMERIC,
        max_weight NUMERIC,
        message_count INTEGER,
        embedding vector(384),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('📦 Creating archival_memories table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS archival_memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        importance INTEGER NOT NULL,
        timestamp BIGINT,
        tags JSONB DEFAULT '[]'::jsonb,
        message_weight NUMERIC,
        embedding vector(384),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('📊 Creating indexes...');

    // Persona blocks indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_blocks_weight
      ON persona_blocks(average_weight DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_blocks_embedding
      ON persona_blocks USING ivfflat (embedding vector_cosine_ops)
    `);

    // Human blocks indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_blocks_weight
      ON human_blocks(average_weight DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_blocks_embedding
      ON human_blocks USING ivfflat (embedding vector_cosine_ops)
    `);

    // Archival memories indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_archival_weight
      ON archival_memories(message_weight DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_archival_embedding
      ON archival_memories USING ivfflat (embedding vector_cosine_ops)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_archival_tags
      ON archival_memories USING GIN(tags)
    `);

    console.log('✅ All tables recreated successfully!');
    console.log('');
    console.log('📋 Tables created:');
    console.log('  - persona_blocks (AI identity and understanding)');
    console.log('  - human_blocks (User identity and information)');
    console.log('  - archival_memories (Long-term conversation memory)');

  } catch (error) {
    console.error('❌ Error resetting tables:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetTables()
  .then(() => {
    console.log('');
    console.log('🎉 Database reset complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to reset database:', error);
    process.exit(1);
  });
