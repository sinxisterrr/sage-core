#!/usr/bin/env tsx
//--------------------------------------------------------------
// Database Seeding Script
// Run with: npx tsx mac-updated/seedDatabase.ts
//--------------------------------------------------------------

import { initDatabaseAndSeed } from "../init.js";
import { logger } from "../../utils/logger.js";

async function main() {
  try {
    logger.info("🌱 Starting database seeding...");

    await initDatabaseAndSeed();

    logger.info("✅ Database seeding complete!");
    process.exit(0);
  } catch (error) {
    logger.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

main();
