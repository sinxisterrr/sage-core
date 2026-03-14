// FILE: src/db/init.ts
//--------------------------------------------------------------
// Database initialization and seeding from JSON files
//--------------------------------------------------------------

import { db, query } from "./db.js";
import { logger } from "../utils/logger.js";
import { readJSON } from "../utils/file.js";
import { runMigrations } from "./migrate.js";
import path from "path";
import fs from "fs/promises";

const BOT_ID = process.env.BOT_ID || "DEFAULT";
const DATA_DIR = path.join(process.cwd(), "data");

//--------------------------------------------------------------
// Schema initialization
//--------------------------------------------------------------

export async function initDatabase() {
  try {
    logger.info("🔧 Initializing database schema...");

    // Run pre-init migrations to update existing tables BEFORE schema creation
    try {
      const preinitPath = path.join(process.cwd(), "src", "db", "preinit.sql");
      const preinit = await fs.readFile(preinitPath, "utf-8");
      await db.query(preinit);
      logger.info("✅ Pre-initialization migrations applied");
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        logger.warn("⚠️  Pre-init migration warning:", error.message);
      }
    }

    // Now run the main schema
    const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
    const schema = await fs.readFile(schemaPath, "utf-8");

    await db.query(schema);

    logger.info("✅ Database schema initialized");
    return true;
  } catch (error) {
    logger.error("❌ Failed to initialize database schema:", error);
    throw error;
  }
}

//--------------------------------------------------------------
// Seeding detection and execution
//--------------------------------------------------------------

async function hasTableBeenSeeded(table: string): Promise<boolean> {
  try {
    const [result] = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${table} WHERE bot_id = $1`,
      [BOT_ID]
    );
    return parseInt(result?.count || "0") > 0;
  } catch (error) {
    logger.error(`Error checking ${table} seed status:`, error);
    return false;
  }
}

//--------------------------------------------------------------
// Seed individual data types
//--------------------------------------------------------------

async function seedLTM() {
  try {
    const filePath = path.join(DATA_DIR, "ltm.json");
    const ltmData = await readJSON<any[] | null>(filePath, null);

    if (!ltmData || !Array.isArray(ltmData)) {
      logger.info("⏭️  No ltm.json found or invalid format - skipping");
      return;
    }

    logger.info(`📚 Seeding ${ltmData.length} LTM entries...`);

    // This will be loaded per-user, but we can seed a default user
    await query(
      `INSERT INTO bot_memory (bot_id, user_id, ltm, traits, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (bot_id, user_id) DO NOTHING`,
      [BOT_ID, "default", JSON.stringify(ltmData), JSON.stringify([])]
    );

    logger.info("✅ LTM data seeded");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      logger.info("⏭️  ltm.json not found - skipping (this is okay)");
    } else {
      logger.error("Error seeding LTM:", error);
    }
  }
}

async function seedTraits() {
  try {
    const filePath = path.join(DATA_DIR, "traits.json");
    const traitsData = await readJSON<any[] | null>(filePath, null);

    if (!traitsData || !Array.isArray(traitsData)) {
      logger.info("⏭️  No traits.json found or invalid format - skipping");
      return;
    }

    logger.info(`📝 Seeding ${traitsData.length} traits...`);

    await query(
      `INSERT INTO bot_memory (bot_id, user_id, ltm, traits, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (bot_id, user_id)
       DO UPDATE SET traits = $4, updated_at = NOW()`,
      [BOT_ID, "default", JSON.stringify([]), JSON.stringify(traitsData)]
    );

    logger.info("✅ Traits data seeded");
  } catch (error: any) {
    if (error.code === "ENOENT") {
      logger.info("⏭️  traits.json not found - skipping (this is okay)");
    } else {
      logger.error("Error seeding traits:", error);
    }
  }
}

async function seedArchivalMemories() {
  try {
    // Check if already seeded
    if (await hasTableBeenSeeded("archival_memories")) {
      logger.info("✅ Archival memories already seeded - skipping");
      return;
    }

    const filePath = path.join(DATA_DIR, "archival_memories.json");
    const memories = await readJSON<any[] | null>(filePath, null);

    if (!memories || !Array.isArray(memories)) {
      logger.info("⏭️  No archival_memories.json found - skipping");
      return;
    }

    logger.info(`🗄️  Seeding ${memories.length} archival memories...`);

    // Batch insert for performance (1000 at a time)
    const BATCH_SIZE = 1000;
    let inserted = 0;

    for (let i = 0; i < memories.length; i += BATCH_SIZE) {
      const batch = memories.slice(i, i + BATCH_SIZE);

      const values: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      for (const mem of batch) {
        values.push(
          `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, NOW())`
        );

        // Add attribution tags based on existing tags
        const tags = mem.tags || [];
        // If tags include "assistant", add "about:persona" tag
        if (tags.includes("assistant") && !tags.includes("about:persona")) {
          tags.push("about:persona");
        }
        // If tags include "user", add "about:human" tag
        if (tags.includes("user") && !tags.includes("about:human")) {
          tags.push("about:human");
        }

        params.push(
          mem.id || `archival_${Date.now()}_${Math.random()}`,
          BOT_ID,
          mem.content || "",
          mem.category || null,
          mem.importance || 5,
          Math.floor(mem.timestamp || Date.now()),  // Convert to integer for BIGINT
          JSON.stringify(tags),
          JSON.stringify(mem.metadata || {})
        );
        paramIndex += 8;
      }

      await query(
        `INSERT INTO archival_memories
         (id, bot_id, content, category, importance, timestamp, tags, metadata, created_at)
         VALUES ${values.join(", ")}
         ON CONFLICT (id) DO NOTHING`,
        params
      );

      inserted += batch.length;
      logger.info(`📊 Progress: ${inserted}/${memories.length} archival memories inserted`);
    }

    logger.info(`✅ Archival memories seeded (${inserted} total)`);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      logger.info("⏭️  archival_memories.json not found - skipping");
    } else {
      logger.error("Error seeding archival memories:", error);
    }
  }
}

async function seedMemoryBlocks() {
  try {
    // Check if already seeded
    if (await hasTableBeenSeeded("memory_blocks")) {
      logger.info("✅ Memory blocks already seeded - skipping");
      return;
    }

    const BATCH_SIZE = 500;

    // Seed human blocks
    const humanPath = path.join(DATA_DIR, "human_blocks.json");
    const humanBlocks = await readJSON<any[] | null>(humanPath, null);

    if (humanBlocks && Array.isArray(humanBlocks)) {
      logger.info(`👤 Seeding ${humanBlocks.length} human blocks...`);

      let inserted = 0;
      for (let i = 0; i < humanBlocks.length; i += BATCH_SIZE) {
        const batch = humanBlocks.slice(i, i + BATCH_SIZE);

        const values: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        for (const block of batch) {
          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, NOW())`
          );
          params.push(
            BOT_ID,
            block.label || "untitled",
            "human",
            block.content || "",
            block.description || null,
            JSON.stringify(block.metadata || {}),
            block.limit || null,
            block.read_only || false
          );
          paramIndex += 8;
        }

        await query(
          `INSERT INTO memory_blocks
           (bot_id, label, block_type, content, description, metadata, limit_value, read_only, created_at)
           VALUES ${values.join(", ")}
           ON CONFLICT (bot_id, label, block_type) DO NOTHING`,
          params
        );

        inserted += batch.length;
        logger.info(`📊 Progress: ${inserted}/${humanBlocks.length} human blocks inserted`);
      }

      logger.info(`✅ Human blocks seeded (${inserted} total)`);
    } else {
      logger.info("⏭️  human_blocks.json not found - skipping");
    }

    // Seed persona blocks
    const personaPath = path.join(DATA_DIR, "persona_blocks.json");
    const personaBlocks = await readJSON<any[] | null>(personaPath, null);

    if (personaBlocks && Array.isArray(personaBlocks)) {
      logger.info(`🤖 Seeding ${personaBlocks.length} persona blocks...`);

      let inserted = 0;
      for (let i = 0; i < personaBlocks.length; i += BATCH_SIZE) {
        const batch = personaBlocks.slice(i, i + BATCH_SIZE);

        const values: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        for (const block of batch) {
          values.push(
            `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, NOW())`
          );
          params.push(
            BOT_ID,
            block.label || "untitled",
            "persona",
            block.content || "",
            block.description || null,
            JSON.stringify(block.metadata || {}),
            block.limit || null,
            block.read_only || false
          );
          paramIndex += 8;
        }

        await query(
          `INSERT INTO memory_blocks
           (bot_id, label, block_type, content, description, metadata, limit_value, read_only, created_at)
           VALUES ${values.join(", ")}
           ON CONFLICT (bot_id, label, block_type) DO NOTHING`,
          params
        );

        inserted += batch.length;
        logger.info(`📊 Progress: ${inserted}/${personaBlocks.length} persona blocks inserted`);
      }

      logger.info(`✅ Persona blocks seeded (${inserted} total)`);
    } else {
      logger.info("⏭️  persona_blocks.json not found - skipping");
    }
  } catch (error: any) {
    if (error.code === "ENOENT") {
      logger.info("⏭️  Memory blocks files not found - skipping");
    } else {
      logger.error("Error seeding memory blocks:", error);
    }
  }
}

//--------------------------------------------------------------
// Main seeding orchestrator
//--------------------------------------------------------------

export async function seedFromJSON() {
  try {
    logger.info("🌱 Starting database seeding from JSON files...");

    // Each function now checks individually if its table has been seeded
    await seedLTM();
    await seedTraits();
    await seedArchivalMemories();
    await seedMemoryBlocks();

    logger.info("🎉 Database seeding complete!");
  } catch (error) {
    logger.error("❌ Error during seeding:", error);
    throw error;
  }
}

//--------------------------------------------------------------
// Background vector index builder
//--------------------------------------------------------------

export async function buildVectorIndexes() {
  try {
    logger.info("🔨 Building vector similarity indexes in background...");

    // Build indexes one at a time to avoid overwhelming the database
    const indexes = [
      // Main memory indexes
      {
        name: "idx_archival_embedding",
        table: "archival_memories",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_archival_embedding ON archival_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      {
        name: "idx_persona_embedding",
        table: "persona_blocks",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_persona_embedding ON persona_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      {
        name: "idx_human_embedding",
        table: "human_blocks",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_human_embedding ON human_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      // RP memory indexes
      {
        name: "idx_rp_archival_embedding",
        table: "rp_archival_memories",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rp_archival_embedding ON rp_archival_memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      {
        name: "idx_rp_persona_embedding",
        table: "rp_persona_blocks",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rp_persona_embedding ON rp_persona_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      {
        name: "idx_rp_human_embedding",
        table: "rp_human_blocks",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rp_human_embedding ON rp_human_blocks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      },
      // Reference text indexes
      {
        name: "idx_reference_embedding",
        table: "reference_texts",
        sql: "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reference_embedding ON reference_texts USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)"
      }
    ];

    for (const idx of indexes) {
      try {
        const startTime = Date.now();
        logger.info(`🔧 Building ${idx.name} on ${idx.table}...`);

        await db.query(idx.sql);

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        logger.info(`✅ ${idx.name} built in ${duration}s`);
      } catch (error: any) {
        // Index might already exist, or building failed - log but don't crash
        if (error.message?.includes("already exists")) {
          logger.info(`✅ ${idx.name} already exists`);
        } else {
          logger.warn(`⚠️  Failed to build ${idx.name}:`, error.message);
        }
      }
    }

    logger.info("🎉 Vector index building complete!");
  } catch (error) {
    logger.error("❌ Error building vector indexes:", error);
    // Don't throw - this is a background operation
  }
}

//--------------------------------------------------------------
// Combined initialization
//--------------------------------------------------------------


export async function initDatabaseAndSeed() {
  // First ensure base tables exist
  await initDatabase();

  // Then run migrations to update schema
  await runMigrations();

  // SEEDING DISABLED - /data should not be pushed to DB
  // Historical data comes from parser only
  logger.info("⏭️  Database seeding disabled - tables will be populated by:");
  logger.info("   - Parser (historical data)");
  logger.info("   - Bot (NEW Discord messages)");
}
