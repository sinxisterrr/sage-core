#!/usr/bin/env tsx
//--------------------------------------------------------------
// Migration: Upgrade embeddings from 384 to 1024 dimensions
// Run with: npx tsx src/db/migrations/upgrade-to-1024-dims.ts
//
// IMPORTANT: This will clear all existing embeddings!
// They will be regenerated with 1024 dims on next use.
//--------------------------------------------------------------

import { db, query } from "../db.js";
import { logger } from "../../utils/logger.js";

async function main() {
  try {
    logger.info("🔄 Starting migration: 384 → 1024 dimension embeddings");
    logger.info("⚠️  This will clear existing embeddings (they'll regenerate automatically)");

    // Step 1: Drop old indexes (they're dimension-specific)
    logger.info("\n1️⃣  Dropping old vector indexes...");
    await query("DROP INDEX IF EXISTS idx_archival_embedding");
    await query("DROP INDEX IF EXISTS idx_persona_embedding");
    await query("DROP INDEX IF EXISTS idx_human_embedding");
    logger.info("✅ Old indexes dropped");

    // Step 2: Alter columns to new dimension
    logger.info("\n2️⃣  Upgrading vector columns to 1024 dimensions...");

    // archival_memories
    await query("ALTER TABLE archival_memories ALTER COLUMN embedding TYPE vector(1024)");
    logger.info("✅ archival_memories.embedding → vector(1024)");

    // persona_blocks
    await query("ALTER TABLE persona_blocks ALTER COLUMN embedding TYPE vector(1024)");
    logger.info("✅ persona_blocks.embedding → vector(1024)");

    // human_blocks
    await query("ALTER TABLE human_blocks ALTER COLUMN embedding TYPE vector(1024)");
    logger.info("✅ human_blocks.embedding → vector(1024)");

    // Step 3: Clear existing embeddings (they're now invalid)
    logger.info("\n3️⃣  Clearing old 384-dim embeddings...");
    await query("UPDATE archival_memories SET embedding = NULL");
    await query("UPDATE persona_blocks SET embedding = NULL");
    await query("UPDATE human_blocks SET embedding = NULL");
    logger.info("✅ Old embeddings cleared");

    // Step 4: Recreate indexes with new dimensions
    logger.info("\n4️⃣  Creating new vector indexes for 1024 dims...");
    await query(
      "CREATE INDEX idx_archival_embedding ON archival_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    );
    await query(
      "CREATE INDEX idx_persona_embedding ON persona_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    );
    await query(
      "CREATE INDEX idx_human_embedding ON human_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
    );
    logger.info("✅ New indexes created");

    // Step 5: Verify
    logger.info("\n5️⃣  Verifying migration...");
    const archivalCount = await query("SELECT COUNT(*) as count FROM archival_memories");
    const personaCount = await query("SELECT COUNT(*) as count FROM persona_blocks");
    const humanCount = await query("SELECT COUNT(*) as count FROM human_blocks");

    logger.info(`\n📊 Migration complete!`);
    logger.info(`   - archival_memories: ${archivalCount[0]?.count || 0} rows (embeddings will regenerate)`);
    logger.info(`   - persona_blocks: ${personaCount[0]?.count || 0} rows (embeddings will regenerate)`);
    logger.info(`   - human_blocks: ${humanCount[0]?.count || 0} rows (embeddings will regenerate)`);
    logger.info(`\n✅ Database upgraded to 1024-dimensional embeddings!`);
    logger.info(`   Next time semantic search runs, embeddings will regenerate with 1024 dims`);

    await db.end();
    process.exit(0);
  } catch (error: any) {
    logger.error("❌ Migration failed:", error.message);
    logger.error(error.stack);
    await db.end();
    process.exit(1);
  }
}

main();
