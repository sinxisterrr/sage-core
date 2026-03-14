#!/usr/bin/env node
//--------------------------------------------------------------
// FILE: src/scripts/embedMigration.ts
// Background script to pre-compute embeddings for archival memories and blocks
// Runs INDEPENDENTLY of the bot so it doesn't block message handling
//--------------------------------------------------------------

import { db, query } from "../db/db.js";
import { logger } from "../utils/logger.js";
import { embedText } from "../memory/embeddingsAdapter.js";

const BOT_ID = process.env.BOT_ID || "DEFAULT";
const BATCH_SIZE = 10; // Process 10 at a time to avoid overwhelming the service
const DELAY_MS = 100; // Small delay between batches

//--------------------------------------------------------------
// Migrate archival memories
//--------------------------------------------------------------

async function migrateArchivalMemories(): Promise<void> {
  logger.info("🔄 Starting archival memories embedding migration...");

  // Get count of memories without embeddings
  const [countResult] = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM archival_memories
     WHERE bot_id = $1 AND (embedding IS NULL OR embedding = 'null'::jsonb)`,
    [BOT_ID]
  );

  const total = parseInt(countResult.count);

  if (total === 0) {
    logger.info("✅ All archival memories already have embeddings!");
    return;
  }

  logger.info(`📊 Found ${total} archival memories without embeddings`);

  let processed = 0;
  let errors = 0;

  while (processed < total) {
    // Get next batch of memories without embeddings
    const memories = await query<{ id: string; content: string }>(
      `SELECT id, content
       FROM archival_memories
       WHERE bot_id = $1 AND (embedding IS NULL OR embedding = 'null'::jsonb)
       ORDER BY importance DESC NULLS LAST, timestamp DESC NULLS LAST
       LIMIT $2`,
      [BOT_ID, BATCH_SIZE]
    );

    if (memories.length === 0) {
      break; // No more to process
    }

    logger.info(`🔄 Processing batch: ${processed + 1}-${processed + memories.length} of ${total}`);

    // Process batch
    for (const mem of memories) {
      try {
        // Generate embedding (first 1000 chars)
        const textToEmbed = mem.content.slice(0, 1000);
        const embedding = await embedText(textToEmbed);

        // Save to database
        await query(
          `UPDATE archival_memories
           SET embedding = $1, last_embedded_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(embedding), mem.id]
        );

        processed++;

        // Progress logging every 10 items
        if (processed % 10 === 0) {
          const progress = ((processed / total) * 100).toFixed(1);
          logger.info(`📈 Progress: ${processed}/${total} (${progress}%) - ${errors} errors`);
        }

      } catch (error: any) {
        errors++;
        logger.error(`❌ Failed to embed archival memory ${mem.id}: ${error.message}`);

        // Mark as failed so we don't retry forever
        await query(
          `UPDATE archival_memories
           SET embedding = '[]'::jsonb, last_embedded_at = NOW()
           WHERE id = $1`,
          [mem.id]
        );
      }
    }

    // Small delay between batches to avoid overwhelming the service
    if (processed < total) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`✅ Archival memory migration complete: ${processed} processed, ${errors} errors`);
}

//--------------------------------------------------------------
// Migrate memory blocks
//--------------------------------------------------------------

async function migrateMemoryBlocks(): Promise<void> {
  logger.info("🔄 Starting memory blocks embedding migration...");

  // Get count of blocks without embeddings
  const [countResult] = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM memory_blocks
     WHERE bot_id = $1 AND (embedding IS NULL OR embedding = 'null'::jsonb)`,
    [BOT_ID]
  );

  const total = parseInt(countResult.count);

  if (total === 0) {
    logger.info("✅ All memory blocks already have embeddings!");
    return;
  }

  logger.info(`📊 Found ${total} memory blocks without embeddings`);

  let processed = 0;
  let errors = 0;

  while (processed < total) {
    // Get next batch of blocks without embeddings
    const blocks = await query<{ id: number; content: string }>(
      `SELECT id, content
       FROM memory_blocks
       WHERE bot_id = $1 AND (embedding IS NULL OR embedding = 'null'::jsonb)
       ORDER BY id
       LIMIT $2`,
      [BOT_ID, BATCH_SIZE]
    );

    if (blocks.length === 0) {
      break;
    }

    logger.info(`🔄 Processing batch: ${processed + 1}-${processed + blocks.length} of ${total}`);

    // Process batch
    for (const block of blocks) {
      try {
        // Generate embedding for full content (blocks are usually smaller)
        const embedding = await embedText(block.content);

        // Save to database
        await query(
          `UPDATE memory_blocks
           SET embedding = $1, last_embedded_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(embedding), block.id]
        );

        processed++;

        if (processed % 10 === 0) {
          const progress = ((processed / total) * 100).toFixed(1);
          logger.info(`📈 Progress: ${processed}/${total} (${progress}%) - ${errors} errors`);
        }

      } catch (error: any) {
        errors++;
        logger.error(`❌ Failed to embed memory block ${block.id}: ${error.message}`);

        // Mark as failed
        await query(
          `UPDATE memory_blocks
           SET embedding = '[]'::jsonb, last_embedded_at = NOW()
           WHERE id = $1`,
          [block.id]
        );
      }
    }

    if (processed < total) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`✅ Memory block migration complete: ${processed} processed, ${errors} errors`);
}

//--------------------------------------------------------------
// Main migration runner
//--------------------------------------------------------------

async function runMigration(): Promise<void> {
  try {
    logger.info("🚀 Starting embedding migration (runs in background, bot stays responsive!)");
    logger.info("=" .repeat(60));

    const startTime = Date.now();

    // Run migrations sequentially
    await migrateArchivalMemories();
    await migrateMemoryBlocks();

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    logger.info("=" .repeat(60));
    logger.info(`🎉 All embeddings migrated successfully in ${elapsed} minutes!`);
    logger.info("💡 Bot will now use pre-computed embeddings for instant semantic search");

    process.exit(0);

  } catch (error: any) {
    logger.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigration();
}

export { migrateArchivalMemories, migrateMemoryBlocks, runMigration };
