// FILE: src/index.ts
// Load environment variables first
import "./utils/env.js";

import { DiscClient } from "./client/DiscClient.js";
import { logger } from "./utils/logger.js";
import { closeDb } from "./db/db.js";
import { initDatabaseAndSeed, buildVectorIndexes } from "./db/init.js";
import { initWhisper } from "./features/whisper.js";
import { initElevenLabs } from "./features/elevenlabs.js";
import { initContinuumMemory } from "./memory/continuumMemory.js";

import { AutonomousSystem } from "./features/autonomous/AutonomousSystem.js";
import { heartbeatScheduler } from "./features/heartbeat/HeartbeatScheduler.js";
import { dailyStatsScheduler } from "./features/dailyStats/DailyStatsScheduler.js";
import { reflectionScheduler } from "./features/reflection/ReflectionScheduler.js";
import { startPeopleSuggestionTracker, stopPeopleSuggestionTracker } from "./features/peopleSuggestionTracker.js";
import { loadAllTextFiles } from "./memory/referenceLoader.js";
import { loadPeopleMap, initializePeopleMapDB } from "./memory/peopleMap.js";
import { loadPeopleFromFile } from "./memory/peopleLoader.js";
import { initializeMemoryManager, initializeMemoryManagerRP } from "./memory/memoryManager.js";
import { cleanupTempDirectory } from "./core/handleMessage.js";

// Export so other modules can access
export let autonomousSystem: AutonomousSystem;

async function main() {
  logger.info("🚀 Starting…");

  // 🧹 Clean up old temp files from previous crashes/sessions
  await cleanupTempDirectory();

  // 🗄️ Initialize database and seed from JSON (first run only)
  await initDatabaseAndSeed();

  // 📖 Load reference texts from /data/*.txt
  // Checks for file changes, deduplicates, and embeds paragraph-by-paragraph
  try {
    await loadAllTextFiles();
  } catch (error: any) {
    logger.error(`❌ Failed to load reference texts on boot: ${error.message}`);
    logger.warn(`⚠️  Bot will continue but reference texts will not be available`);
  }

  // 🧠 Initialize Continuum Memory System
  await initContinuumMemory();

  // 👥 Initialize People Map database & load connections
  try {
    await initializePeopleMapDB();
    await loadPeopleMap();
    // Load people from data file if it exists
    await loadPeopleFromFile();
  } catch (error: any) {
    logger.warn(`⚠️ Failed to load people map: ${error.message}`);
  }

  // 🧠 Initialize Memory Manager (decay, favorites, cleanup)
  try {
    await initializeMemoryManager();
    await initializeMemoryManagerRP();
  } catch (error: any) {
    logger.warn(`⚠️ Memory manager init failed: ${error.message}`);
  }

  // 🎤 Initialize Whisper transcription
  initWhisper();

  // 🔊 Initialize ElevenLabs voice synthesis
  await initElevenLabs();

  // 🤖 Create Discord client
  const client = new DiscClient();

  process.on("SIGINT", async () => {
    logger.info("🧹 SIGINT: shutting down…");
    stopPeopleSuggestionTracker();
    reflectionScheduler.stop();
    await cleanupTempDirectory(0); // Clean up ALL temp files on exit
    await closeDb();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("🧹 SIGTERM: shutting down…");
    stopPeopleSuggestionTracker();
    reflectionScheduler.stop();
    await cleanupTempDirectory(0); // Clean up ALL temp files on exit
    await closeDb();
    process.exit(0);
  });

  // Global error handlers to prevent silent crashes
  process.on("uncaughtException", (error) => {
    logger.error("🔥 UNCAUGHT EXCEPTION:", error);
    logger.error("Stack trace:", error.stack);
    // Don't exit - log and continue (Discord bot should stay up)
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("🔥 UNHANDLED REJECTION at:", promise);
    logger.error("Reason:", reason);
    // Don't exit - log and continue
  });

  await client.start();

  // 🤖 Initialize autonomous behavior system AFTER client is ready
  // client.user is now available since start() waits for ready event
  autonomousSystem = new AutonomousSystem(client.user?.id || "unknown");
  logger.info(`🤖 Autonomous system initialized with bot ID: ${client.user?.id}`);

  // 📊 Start daily stats scheduler (posts at midnight)
  dailyStatsScheduler.setClient(client);
  dailyStatsScheduler.start();

  // 🌙 Start reflection scheduler (midnight and noon introspection time)
  reflectionScheduler.setClient(client);
  reflectionScheduler.start();

  // 👥 Start people suggestion tracker (monitors name mentions)
  startPeopleSuggestionTracker();

  // 🔨 Build vector indexes in background (non-blocking)
  // This runs after bot is online so it doesn't block startup
  buildVectorIndexes().catch((err) => {
    logger.error("Background index building failed:", err);
  });
}

main().catch((err) => {
  logger.error("🔥 Fatal startup error:", err);
  process.exit(1);
});
