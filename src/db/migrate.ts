// FILE: src/db/migrate.ts
//--------------------------------------------------------------
// Database migration runner
//--------------------------------------------------------------

import { db } from "./db.js";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";

const MIGRATIONS_DIR = path.join(process.cwd(), "src", "db", "migrations");

//--------------------------------------------------------------
// Create migrations tracking table
//--------------------------------------------------------------

async function createMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

//--------------------------------------------------------------
// Check if migration has been applied
//--------------------------------------------------------------

async function isMigrationApplied(migrationName: string): Promise<boolean> {
  const result = await db.query(
    "SELECT 1 FROM schema_migrations WHERE migration_name = $1",
    [migrationName]
  );
  return result.rows.length > 0;
}

//--------------------------------------------------------------
// Mark migration as applied
//--------------------------------------------------------------

async function markMigrationApplied(migrationName: string) {
  await db.query(
    "INSERT INTO schema_migrations (migration_name) VALUES ($1)",
    [migrationName]
  );
}

//--------------------------------------------------------------
// Run all pending migrations
//--------------------------------------------------------------

export async function runMigrations() {
  try {
    logger.info("🔄 Running database migrations...");

    // Create migrations tracking table
    await createMigrationsTable();

    // Check if migrations directory exists
    try {
      await fs.access(MIGRATIONS_DIR);
    } catch {
      logger.info("📁 No migrations directory found - skipping");
      return;
    }

    // Read all migration files
    const files = await fs.readdir(MIGRATIONS_DIR);
    const migrationFiles = files
      .filter((f) => f.endsWith(".sql"))
      .sort(); // Sort to ensure migrations run in order

    if (migrationFiles.length === 0) {
      logger.info("✅ No migrations to run");
      return;
    }

    let appliedCount = 0;

    for (const file of migrationFiles) {
      const migrationName = file.replace(".sql", "");

      // Skip if already applied
      if (await isMigrationApplied(migrationName)) {
        continue;
      }

      logger.info(`⚡ Running migration: ${migrationName}`);

      // Read and execute migration
      const migrationPath = path.join(MIGRATIONS_DIR, file);
      const sql = await fs.readFile(migrationPath, "utf-8");

      await db.query(sql);
      await markMigrationApplied(migrationName);

      appliedCount++;
      logger.info(`✅ Applied migration: ${migrationName}`);
    }

    if (appliedCount === 0) {
      logger.info("✅ All migrations up to date");
    } else {
      logger.info(`✅ Applied ${appliedCount} migration(s)`);
    }
  } catch (error) {
    logger.error("❌ Migration failed:", error);
    throw error;
  }
}
