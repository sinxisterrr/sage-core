#!/usr/bin/env node
//--------------------------------------------------------------
// FILE: src/scripts/embedMigrationFromJSON.ts
// Reads /data/*.json files and populates DB with embeddings
// For clean slate setup - bot works immediately with JSON fallback
//--------------------------------------------------------------

import { query } from "../db/db.js";
import { logger } from "../utils/logger.js";
import { embedText } from "../memory/embeddingsAdapter.js";
import { readJSON } from "../utils/file.js";
import path from "path";

const BOT_ID = process.env.BOT_ID || "DEFAULT";
const DATA_DIR = path.join(process.cwd(), "data");
const BATCH_SIZE = 10;
const DELAY_MS = 100;

//--------------------------------------------------------------
// Migrate archival memories from JSON
//--------------------------------------------------------------

async function migrateArchivalFromJSON(): Promise<void> {
  logger.info("🔄 Migrating archival memories from /data/archival_memories.json...");

  const filePath = path.join(DATA_DIR, "archival_memories.json");
  const memories = await readJSON<any[]>(filePath, []);

  if (memories.length === 0) {
    logger.info("⏭️  No archival memories found in JSON");
    return;
  }

  logger.info(`📊 Found ${memories.length} archival memories in JSON`);

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    const batch = memories.slice(i, i + BATCH_SIZE);

    logger.info(`🔄 Processing batch: ${processed + 1}-${processed + batch.length} of ${memories.length}`);

    for (const mem of batch) {
      try {
        // Check if already exists
        const [existing] = await query<{ id: string }>(
          `SELECT id FROM archival_memories WHERE id = $1`,
          [mem.id]
        );

        if (existing) {
          skipped++;
          continue;
        }

        // Generate embedding
        const textToEmbed = mem.content.slice(0, 1000);
        const embedding = await embedText(textToEmbed);

        // Insert with embedding
        await query(
          `INSERT INTO archival_memories
           (id, bot_id, content, category, importance, timestamp, tags, metadata, embedding, last_embedded_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
          [
            mem.id || `archival_${Date.now()}_${Math.random()}`,
            BOT_ID,
            mem.content || "",
            mem.category || null,
            mem.importance || 5,
            Math.floor(mem.timestamp || Date.now()),
            JSON.stringify(mem.tags || []),
            JSON.stringify(mem.metadata || {}),
            JSON.stringify(embedding)
          ]
        );

        processed++;

        if (processed % 10 === 0) {
          const progress = ((processed / memories.length) * 100).toFixed(1);
          logger.info(`📈 Progress: ${processed}/${memories.length} (${progress}%) - ${errors} errors, ${skipped} skipped`);
        }

      } catch (error: any) {
        errors++;
        logger.error(`❌ Failed to migrate archival memory: ${error.message}`);
      }
    }

    if (i + BATCH_SIZE < memories.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`✅ Archival migration complete: ${processed} inserted, ${skipped} skipped, ${errors} errors`);
}

//--------------------------------------------------------------
// Migrate human blocks from JSON
//--------------------------------------------------------------

async function migrateHumanBlocksFromJSON(): Promise<void> {
  logger.info("🔄 Migrating human blocks from /data/human_blocks.json...");

  const filePath = path.join(DATA_DIR, "human_blocks.json");
  const blocks = await readJSON<any[]>(filePath, []);

  if (blocks.length === 0) {
    logger.info("⏭️  No human blocks found in JSON");
    return;
  }

  logger.info(`📊 Found ${blocks.length} human blocks in JSON`);

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  for (const block of blocks) {
    try {
      // Check if already exists
      const [existing] = await query<{ id: number }>(
        `SELECT id FROM memory_blocks WHERE bot_id = $1 AND label = $2 AND block_type = 'human'`,
        [BOT_ID, block.label]
      );

      if (existing) {
        skipped++;
        continue;
      }

      // Generate embedding
      const embedding = await embedText(block.content);

      // Insert with embedding
      await query(
        `INSERT INTO memory_blocks
         (bot_id, label, block_type, content, description, metadata, limit_value, read_only, embedding, last_embedded_at, created_at)
         VALUES ($1, $2, 'human', $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          BOT_ID,
          block.label || "untitled",
          block.content || "",
          block.description || null,
          JSON.stringify(block.metadata || {}),
          block.limit || null,
          block.read_only || false,
          JSON.stringify(embedding)
        ]
      );

      processed++;

      if (processed % 10 === 0) {
        const progress = ((processed / blocks.length) * 100).toFixed(1);
        logger.info(`📈 Progress: ${processed}/${blocks.length} (${progress}%) - ${errors} errors, ${skipped} skipped`);
      }

    } catch (error: any) {
      errors++;
      logger.error(`❌ Failed to migrate human block: ${error.message}`);
    }

    if (processed < blocks.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`✅ Human blocks migration complete: ${processed} inserted, ${skipped} skipped, ${errors} errors`);
}

//--------------------------------------------------------------
// Migrate persona blocks from JSON
//--------------------------------------------------------------

async function migratePersonaBlocksFromJSON(): Promise<void> {
  logger.info("🔄 Migrating persona blocks from /data/persona_blocks.json...");

  const filePath = path.join(DATA_DIR, "persona_blocks.json");
  const blocks = await readJSON<any[]>(filePath, []);

  if (blocks.length === 0) {
    logger.info("⏭️  No persona blocks found in JSON");
    return;
  }

  logger.info(`📊 Found ${blocks.length} persona blocks in JSON`);

  let processed = 0;
  let errors = 0;
  let skipped = 0;

  for (const block of blocks) {
    try {
      // Check if already exists
      const [existing] = await query<{ id: number }>(
        `SELECT id FROM memory_blocks WHERE bot_id = $1 AND label = $2 AND block_type = 'persona'`,
        [BOT_ID, block.label]
      );

      if (existing) {
        skipped++;
        continue;
      }

      // Generate embedding
      const embedding = await embedText(block.content);

      // Insert with embedding
      await query(
        `INSERT INTO memory_blocks
         (bot_id, label, block_type, content, description, metadata, limit_value, read_only, embedding, last_embedded_at, created_at)
         VALUES ($1, $2, 'persona', $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          BOT_ID,
          block.label || "untitled",
          block.content || "",
          block.description || null,
          JSON.stringify(block.metadata || {}),
          block.limit || null,
          block.read_only || false,
          JSON.stringify(embedding)
        ]
      );

      processed++;

      if (processed % 10 === 0) {
        const progress = ((processed / blocks.length) * 100).toFixed(1);
        logger.info(`📈 Progress: ${processed}/${blocks.length} (${progress}%) - ${errors} errors, ${skipped} skipped`);
      }

    } catch (error: any) {
      errors++;
      logger.error(`❌ Failed to migrate persona block: ${error.message}`);
    }

    if (processed < blocks.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`✅ Persona blocks migration complete: ${processed} inserted, ${skipped} skipped, ${errors} errors`);
}

//--------------------------------------------------------------
// Main migration runner
//--------------------------------------------------------------

async function runMigration(): Promise<void> {
  try {
    logger.info("🚀 Starting JSON → DB migration with embeddings");
    logger.info("💡 Bot can run immediately - will use JSON fallback until migration completes");
    logger.info("=".repeat(60));

    const startTime = Date.now();

    // Run all 3 migrations
    await migrateArchivalFromJSON();
    await migrateHumanBlocksFromJSON();
    await migratePersonaBlocksFromJSON();

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    logger.info("=".repeat(60));
    logger.info(`🎉 All migrations complete in ${elapsed} minutes!`);
    logger.info("💡 Bot will now use embedded DB for instant semantic search");

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

export { migrateArchivalFromJSON, migrateHumanBlocksFromJSON, migratePersonaBlocksFromJSON, runMigration };
