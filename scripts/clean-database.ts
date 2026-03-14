#!/usr/bin/env tsx
//--------------------------------------------------------------
// Clean Database - Remove all old tables, keep only continuum tables
//--------------------------------------------------------------

import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function cleanDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();

  try {
    console.log('🧹 CLEANING DATABASE\n');
    console.log('=' .repeat(60));

    // Drop all old tables
    console.log('\n🗑️  Dropping old tables...');

    const tablesToDrop = [
      'bot_memory',
      'compressed_stm',
      'conversation_log',
      'identity_core',
      'memories',
      'memory_blocks',
      'task_schedule',
      'schema_migrations'
    ];

    for (const table of tablesToDrop) {
      try {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
        console.log(`   ✅ Dropped ${table}`);
      } catch (error: any) {
        console.log(`   ⚠️  ${table} doesn't exist or already dropped`);
      }
    }

    console.log('\n✅ Old tables removed');

    // Enable pgvector
    console.log('\n🔧 Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('   ✅ pgvector enabled');

    // Create continuum tables
    console.log('\n📦 Creating continuum tables...');

    // archival_memories
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
    console.log('   ✅ archival_memories');

    // persona_blocks (human_blocks uses same structure)
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
    console.log('   ✅ persona_blocks');

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
    console.log('   ✅ human_blocks');

    // Create indexes
    console.log('\n📊 Creating indexes...');

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

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_blocks_weight
      ON persona_blocks(average_weight DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_blocks_embedding
      ON persona_blocks USING ivfflat (embedding vector_cosine_ops)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_blocks_weight
      ON human_blocks(average_weight DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_blocks_embedding
      ON human_blocks USING ivfflat (embedding vector_cosine_ops)
    `);

    console.log('   ✅ All indexes created');

    console.log('\n' + '=' .repeat(60));
    console.log('✅ DATABASE CLEANED SUCCESSFULLY!\n');
    console.log('Tables:');
    console.log('  ✅ archival_memories (NEW memories from Discord)');
    console.log('  ✅ persona_blocks (AI identity/understanding)');
    console.log('  ✅ human_blocks (User identity/information)');
    console.log('\nDatabase is ready for:');
    console.log('  - Bot to archive NEW Discord messages');
    console.log('  - Parser to populate historical data\n');

  } catch (error) {
    console.error('❌ Error cleaning database:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDatabase()
  .then(() => {
    console.log('🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to clean database:', error);
    process.exit(1);
  });