#!/usr/bin/env tsx
//--------------------------------------------------------------
// Database Check Script
// Run with: npx tsx mac-updated/checkDatabase.ts
//--------------------------------------------------------------

import { db, query } from "../db.js";
import { logger } from "../../utils/logger.js";

const BOT_ID = process.env.BOT_ID || "DEFAULT";

async function main() {
  try {
    logger.info("🔍 Checking database contents...");

    // Check bot_memory
    const botMemory = await query(
      "SELECT bot_id, user_id, jsonb_array_length(ltm) as ltm_count, jsonb_array_length(traits) as traits_count FROM bot_memory WHERE bot_id = $1",
      [BOT_ID]
    );
    logger.info("\n📚 Bot Memory:");
    console.table(botMemory);

    // Check archival_memories
    const archivalCount = await query(
      "SELECT COUNT(*) as count FROM archival_memories WHERE bot_id = $1",
      [BOT_ID]
    );
    logger.info(`\n🗄️  Archival Memories: ${archivalCount[0]?.count || 0} entries`);

    // Check memory_blocks
    const humanBlocks = await query(
      "SELECT COUNT(*) as count FROM memory_blocks WHERE bot_id = $1 AND block_type = 'human'",
      [BOT_ID]
    );
    const personaBlocks = await query(
      "SELECT COUNT(*) as count FROM memory_blocks WHERE bot_id = $1 AND block_type = 'persona'",
      [BOT_ID]
    );
    logger.info(`\n👤 Human Blocks: ${humanBlocks[0]?.count || 0} entries`);
    logger.info(`🤖 Persona Blocks: ${personaBlocks[0]?.count || 0} entries`);

    // Check conversation log
    const conversationCount = await query(
      "SELECT COUNT(*) as count FROM conversation_log"
    );
    logger.info(`\n💬 Conversation Log: ${conversationCount[0]?.count || 0} entries`);

    // Sample some data
    const sampleLTM = await query(
      "SELECT ltm FROM bot_memory WHERE bot_id = $1 LIMIT 1",
      [BOT_ID]
    );
    if (sampleLTM.length > 0 && sampleLTM[0].ltm) {
      logger.info(`\n📖 Sample LTM entries (first 3):`);
      const ltmArray = sampleLTM[0].ltm;
      console.log(JSON.stringify(ltmArray.slice(0, 3), null, 2));
    }

    const sampleArchival = await query(
      "SELECT content, category, importance FROM archival_memories WHERE bot_id = $1 LIMIT 3",
      [BOT_ID]
    );
    if (sampleArchival.length > 0) {
      logger.info(`\n📚 Sample Archival Memories:`);
      console.table(sampleArchival);
    }

    await db.end();
    process.exit(0);
  } catch (error) {
    logger.error("❌ Check failed:", error);
    await db.end();
    process.exit(1);
  }
}

main();
