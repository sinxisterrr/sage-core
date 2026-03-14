//--------------------------------------------------------------
// FILE: src/memory/memoryManager.ts
// Memory Lifecycle Management - Decay, Favorites, Forgetting
// Gives Solstice control over his own memory storage
//
// REGULAR MEMORY STRATEGY:
// - Memories decay daily (0.01 per day)
// - Fade at 0.3 relevance (still searchable, 50% penalty)
// - Storage warnings at 75%, 80%, 85%
// - At 90% storage: AUTO-CLEANUP triggers
//   1. Deletes forgotten/faded memories (oldest/lowest relevance first)
//   2. Critical memories backed up to data/memory_backups/
//   3. Deletes until 75% storage
//
// RP MEMORY STRATEGY:
// - RP memories DO NOT decay (stay at full strength forever)
// - Storage warnings at 75%, 80%, 85% to allow manual archiving
// - At 90% storage: AUTO-CLEANUP triggers
//   1. Oldest RP channels backed up to data/rp_backups/
//   2. Channels deleted from database until 75% storage
//   3. Backups are JSON files that can be manually restored
//--------------------------------------------------------------

import { query } from '../db/db.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

//--------------------------------------------------------------
// Types
//--------------------------------------------------------------

export type MemoryState = 'active' | 'favorite' | 'faded' | 'forgotten';

export interface MemoryRecord {
  id: string;
  content: string;
  category: string;
  importance: number;
  timestamp: number;
  state: MemoryState;
  relevance_score: number;
  last_accessed: number | null;
  mira_type?: string;  // MIRA classification: memory, identity, relationship, agent
  metadata: any;
}

export interface MemoryStats {
  totalMemories: number;
  byState: {
    active: number;
    favorite: number;
    faded: number;
    forgotten: number;
  };
  storageUsedMB: number;
  storageLimitMB: number;
  storagePercent: number;
}

//--------------------------------------------------------------
// Configuration
//--------------------------------------------------------------

const STORAGE_LIMIT_MB = 5 * 1024; // 5GB in MB
const CLEANUP_TRIGGER_PERCENT = 90;
const CLEANUP_TARGET_PERCENT = 75;
let DECAY_RATE = 0.01; // Daily decay amount (AI-controllable)
const FADE_THRESHOLD = 0.3; // Below this, memory becomes 'faded'
const RELEVANCE_BOOST_ON_ACCESS = 0.1;

// Storage warning thresholds (both regular and RP)
const WARNING_THRESHOLDS = [75, 80, 85]; // Warn at these percentages
const RP_WARNING_THRESHOLDS = [75, 80, 85];
let lastWarningLevel = 0; // Track which warning was last shown (regular memories)
let lastRPWarningLevel = 0; // Track which warning was last shown (RP memories)

//--------------------------------------------------------------
// Storage Calculation
//--------------------------------------------------------------

/**
 * Get current storage usage statistics
 */
export async function getMemoryStats(): Promise<MemoryStats> {
  try {
    // Get counts by state
    const countResult = await query<{ state: string; count: string }>(`
      SELECT
        COALESCE(state, 'active') as state,
        COUNT(*) as count
      FROM archival_memories
      GROUP BY COALESCE(state, 'active')
    `);

    const byState = {
      active: 0,
      favorite: 0,
      faded: 0,
      forgotten: 0
    };

    let totalMemories = 0;
    for (const row of countResult) {
      const state = row.state as MemoryState;
      const count = parseInt(row.count);
      if (state in byState) {
        byState[state] = count;
      }
      totalMemories += count;
    }

    // Estimate storage size (content + embedding)
    // Average memory: ~2KB content + 6KB embedding (1536 floats * 4 bytes) ≈ 8KB
    const avgMemorySizeKB = 8;
    const storageUsedMB = (totalMemories * avgMemorySizeKB) / 1024;

    return {
      totalMemories,
      byState,
      storageUsedMB,
      storageLimitMB: STORAGE_LIMIT_MB,
      storagePercent: (storageUsedMB / STORAGE_LIMIT_MB) * 100
    };
  } catch (error) {
    logger.error('Failed to get memory stats:', error);
    return {
      totalMemories: 0,
      byState: { active: 0, favorite: 0, faded: 0, forgotten: 0 },
      storageUsedMB: 0,
      storageLimitMB: STORAGE_LIMIT_MB,
      storagePercent: 0
    };
  }
}

/**
 * Format memory stats for display
 */
export function formatMemoryStats(stats: MemoryStats): string {
  const used = stats.storageUsedMB.toFixed(1);
  const limit = (stats.storageLimitMB / 1024).toFixed(1); // Convert to GB for display
  const percent = stats.storagePercent.toFixed(1);

  let status = '🟢';
  if (stats.storagePercent >= 90) status = '🔴';
  else if (stats.storagePercent >= 75) status = '🟡';

  return `${status} **Memory Storage:** ${used}MB / ${limit}GB (${percent}%)
📊 **By State:**
  - Active: ${stats.byState.active}
  - Favorite: ${stats.byState.favorite} ⭐
  - Faded: ${stats.byState.faded}
  - Forgotten: ${stats.byState.forgotten}
📝 **Total Memories:** ${stats.totalMemories}`;
}

//--------------------------------------------------------------
// Memory State Management
//--------------------------------------------------------------

/**
 * Mark a memory as favorite (protected from decay)
 */
export async function favoriteMemory(memoryId: string): Promise<boolean> {
  try {
    // Check current favorite count before adding
    const countResult = await query<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM archival_memories
      WHERE state = 'favorite'
    `);

    const currentFavorites = parseInt(countResult[0]?.count || '0', 10);
    const MAX_FAVORITES = 100;

    if (currentFavorites >= MAX_FAVORITES) {
      logger.warn(`⚠️ Cannot favorite memory ${memoryId}: limit reached (${currentFavorites}/${MAX_FAVORITES})`);
      throw new Error(`Favorite limit reached! You have ${currentFavorites} favorited memories. Maximum is ${MAX_FAVORITES}. Unfavorite some memories first.`);
    }

    const result = await query(`
      UPDATE archival_memories
      SET state = 'favorite', relevance_score = 1.0
      WHERE id = $1
      RETURNING id
    `, [memoryId]);

    if (result.length > 0) {
      logger.info(`⭐ Memory favorited: ${memoryId} (${currentFavorites + 1}/${MAX_FAVORITES})`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to favorite memory:', error);
    throw error; // Re-throw so the tool executor can catch it
  }
}

/**
 * Get the current number of favorited memories
 */
export async function getFavoriteCount(): Promise<number> {
  const result = await query<{ count: string }>(`SELECT COUNT(*) as count FROM archival_memories WHERE state = 'favorite'`);
  return parseInt(result[0]?.count || '0', 10);
}

/**
 * Get the list of currently favorited memories (for swap prompts)
 */
export async function getFavoritedMemories(): Promise<{ id: string; content: string }[]> {
  return await query<{ id: string; content: string }>(`
    SELECT id, content FROM archival_memories
    WHERE state = 'favorite'
    ORDER BY timestamp ASC
    LIMIT 30
  `);
}

/**
 * Remove favorite status from a memory
 */
export async function unfavoriteMemory(memoryId: string): Promise<boolean> {
  try {
    const result = await query(`
      UPDATE archival_memories
      SET state = 'active'
      WHERE id = $1 AND state = 'favorite'
      RETURNING id
    `, [memoryId]);

    if (result.length > 0) {
      logger.info(`⭐ Memory unfavorited: ${memoryId}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to unfavorite memory:', error);
    return false;
  }
}

/**
 * List all favorite memories
 */
export async function listFavoriteMemories(limit: number = 50): Promise<Array<{
  id: string;
  content: string;
  category: string;
  messageWeight: number;
  timestamp: number | null;
}>> {
  try {
    const result = await query<any>(`
      SELECT id, content, category, message_weight, timestamp
      FROM archival_memories
      WHERE state = 'favorite'
      ORDER BY message_weight DESC, timestamp DESC
      LIMIT $1
    `, [limit]);

    return result.map(row => ({
      id: row.id,
      content: row.content,
      category: row.category,
      messageWeight: row.message_weight,
      timestamp: row.timestamp
    }));
  } catch (error) {
    logger.error('Failed to list favorite memories:', error);
    return [];
  }
}

/**
 * Soft delete a memory (mark as forgotten)
 */
export async function forgetMemory(memoryId: string, reason?: string): Promise<boolean> {
  try {
    const result = await query(`
      UPDATE archival_memories
      SET state = 'forgotten',
          metadata = jsonb_set(
            COALESCE(metadata, '{}')::jsonb,
            '{forgottenReason}',
            $2::jsonb
          )
      WHERE id = $1 AND state != 'favorite'
      RETURNING id
    `, [memoryId, JSON.stringify(reason || 'No reason provided')]);

    if (result.length > 0) {
      logger.info(`🗑️ Memory forgotten: ${memoryId}${reason ? ` (${reason})` : ''}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to forget memory:', error);
    return false;
  }
}

/**
 * Drift a memory - reduce its weight/importance by 30% without forgetting it
 * Makes it less likely to be recalled but keeps it retrievable
 */
export async function driftMemory(memoryId: string, reason?: string): Promise<boolean> {
  try {
    const result = await query(`
      UPDATE archival_memories
      SET message_weight = message_weight * 0.7,
          metadata = jsonb_set(
            COALESCE(metadata, '{}')::jsonb,
            '{driftReason}',
            $2::jsonb
          )
      WHERE id = $1
      RETURNING id, message_weight
    `, [memoryId, JSON.stringify(reason || 'Drifted manually')]);

    if (result.length > 0) {
      const newWeight = result[0].message_weight;
      logger.info(`📉 Memory drifted: ${memoryId} (weight → ${parseFloat(newWeight).toFixed(1)})${reason ? ` - ${reason}` : ''}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to drift memory:', error);
    return false;
  }
}

/**
 * Hard delete a memory (permanent, frees storage)
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  try {
    const result = await query(`
      DELETE FROM archival_memories
      WHERE id = $1 AND state != 'favorite'
      RETURNING id
    `, [memoryId]);

    if (result.length > 0) {
      logger.info(`🗑️ Memory permanently deleted: ${memoryId}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to delete memory:', error);
    return false;
  }
}

/**
 * Boost relevance when a memory is accessed/retrieved
 */
export async function boostMemoryRelevance(memoryId: string): Promise<void> {
  try {
    await query(`
      UPDATE archival_memories
      SET relevance_score = LEAST(1.0, COALESCE(relevance_score, 1.0) + $2),
          last_accessed = $3
      WHERE id = $1 AND state NOT IN ('forgotten')
    `, [memoryId, RELEVANCE_BOOST_ON_ACCESS, Date.now()]);
  } catch (error) {
    // Silent fail - don't break retrieval if boost fails
    logger.warn('Failed to boost memory relevance:', error);
  }
}

//--------------------------------------------------------------
// Memory Search/Review
//--------------------------------------------------------------

/**
 * Search memories by content (for auditing)
 */
export async function searchMemories(
  searchQuery: string,
  options: {
    state?: MemoryState;
    category?: string;
    limit?: number;
    includeEmbedding?: boolean;
  } = {}
): Promise<MemoryRecord[]> {
  try {
    const limit = options.limit || 20;
    const stateFilter = options.state ? `AND state = '${options.state}'` : '';
    const categoryFilter = options.category ? `AND category = '${options.category}'` : '';

    const results = await query<MemoryRecord>(`
      SELECT id, content, category, importance, timestamp,
             COALESCE(state, 'active') as state,
             COALESCE(relevance_score, 1.0) as relevance_score,
             last_accessed, metadata
      FROM archival_memories
      WHERE content ILIKE $1
      ${stateFilter}
      ${categoryFilter}
      ORDER BY timestamp DESC
      LIMIT $2
    `, [`%${searchQuery}%`, limit]);

    return results;
  } catch (error) {
    logger.error('Failed to search memories:', error);
    return [];
  }
}

/**
 * Get memories by state (for review)
 */
export async function getMemoriesByState(
  state: MemoryState,
  limit: number = 20,
  category?: string
): Promise<MemoryRecord[]> {
  try {
    const categoryFilter = category ? `AND category = '${category}'` : '';

    const results = await query<MemoryRecord>(`
      SELECT id, content, category, importance, timestamp,
             COALESCE(state, 'active') as state,
             COALESCE(relevance_score, 1.0) as relevance_score,
             last_accessed, metadata
      FROM archival_memories
      WHERE COALESCE(state, 'active') = $1
      ${categoryFilter}
      ORDER BY relevance_score ASC, timestamp ASC
      LIMIT $2
    `, [state, limit]);

    return results;
  } catch (error) {
    logger.error('Failed to get memories by state:', error);
    return [];
  }
}

/**
 * Get memories by category (e.g., 'reflection', 'internal-thought')
 */
export async function getMemoriesByCategory(
  category: string,
  limit: number = 20
): Promise<MemoryRecord[]> {
  try {
    const results = await query<MemoryRecord>(`
      SELECT id, content, category, importance, timestamp,
             COALESCE(state, 'active') as state,
             COALESCE(relevance_score, 1.0) as relevance_score,
             last_accessed, metadata
      FROM archival_memories
      WHERE category = $1
        AND COALESCE(state, 'active') NOT IN ('forgotten')
      ORDER BY timestamp DESC
      LIMIT $2
    `, [category, limit]);

    return results;
  } catch (error) {
    logger.error('Failed to get memories by category:', error);
    return [];
  }
}

//--------------------------------------------------------------
// Decay System
//--------------------------------------------------------------

/**
 * Apply daily decay to all non-favorite memories
 * Should be called once per day (e.g., by heartbeat scheduler)
 */
export async function applyMemoryDecay(): Promise<{
  decayed: number;
  faded: number;
}> {
  try {
    // Decay all active memories
    const decayResult = await query<{ count: string }>(`
      UPDATE archival_memories
      SET relevance_score = GREATEST(0, COALESCE(relevance_score, 1.0) - $1)
      WHERE state IN ('active', 'faded') OR state IS NULL
      RETURNING id
    `, [DECAY_RATE]);

    const decayed = decayResult.length;

    // Move memories below threshold to 'faded'
    const fadeResult = await query<{ count: string }>(`
      UPDATE archival_memories
      SET state = 'faded'
      WHERE (state = 'active' OR state IS NULL)
        AND relevance_score < $1
      RETURNING id
    `, [FADE_THRESHOLD]);

    const faded = fadeResult.length;

    if (decayed > 0 || faded > 0) {
      logger.info(`🧠 Memory decay applied: ${decayed} decayed, ${faded} faded`);
    }

    return { decayed, faded };
  } catch (error) {
    logger.error('Failed to apply memory decay:', error);
    return { decayed: 0, faded: 0 };
  }
}

//--------------------------------------------------------------
// Storage Warnings & Backup (Regular Memories)
//--------------------------------------------------------------

/**
 * Check regular memory storage and emit warnings at thresholds
 * Warns at 75%, 80%, 85% to give user awareness before auto-cleanup
 */
export async function checkStorageWarnings(): Promise<void> {
  try {
    const stats = await getMemoryStats();
    const currentPercent = stats.storagePercent;

    // Find the highest threshold crossed
    let highestCrossed = 0;
    for (const threshold of WARNING_THRESHOLDS) {
      if (currentPercent >= threshold) {
        highestCrossed = threshold;
      }
    }

    // Only warn if we've crossed a new threshold
    if (highestCrossed > lastWarningLevel) {
      lastWarningLevel = highestCrossed;

      const emoji = highestCrossed >= 85 ? '🔴' : highestCrossed >= 80 ? '🟡' : '🟢';
      logger.warn(`${emoji} [Memory] Storage at ${currentPercent.toFixed(1)}% (${stats.storageUsedMB.toFixed(0)}MB / ${(stats.storageLimitMB / 1024).toFixed(1)}GB)`);
      logger.warn(`⚠️  [Memory] Approaching cleanup threshold (90%). Decay will accelerate cleanup of faded memories.`);

      if (highestCrossed >= 85) {
        logger.warn(`🚨 [Memory] CRITICAL: Storage at 85%+. Auto-cleanup will delete faded/forgotten memories at 90%.`);
      }
    }
  } catch (error) {
    logger.error('[Memory] Storage warning check failed:', error);
  }
}

/**
 * Export critical memories to JSON backup before mass deletion
 * Backs up active memories with high relevance that might be caught in cleanup
 */
async function exportCriticalMemoriesToBackup(): Promise<string | null> {
  try {
    // Get active memories with relevance > 0.7 (might be valuable)
    const criticalMemories = await query(`
      SELECT
        content, category, importance, message_weight as "messageWeight",
        timestamp, tags, metadata, state, relevance_score as "relevanceScore"
      FROM archival_memories
      WHERE state IN ('active', 'faded')
        AND relevance_score > 0.7
      ORDER BY relevance_score DESC, importance DESC
      LIMIT 500
    `);

    if (criticalMemories.length === 0) {
      return null;
    }

    // Create backup directory
    const backupDir = path.join(process.cwd(), 'data', 'memory_backups');
    await fs.mkdir(backupDir, { recursive: true });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `critical_memories_${timestamp}.json`;
    const backupPath = path.join(backupDir, filename);

    // Write backup
    await fs.writeFile(backupPath, JSON.stringify(criticalMemories, null, 2));

    logger.info(`💾 [Memory] Exported ${criticalMemories.length} critical memories to ${filename}`);
    return backupPath;
  } catch (error) {
    logger.error(`[Memory] Failed to export critical memories:`, error);
    return null;
  }
}

//--------------------------------------------------------------
// Auto-Cleanup System
//--------------------------------------------------------------

/**
 * Check if cleanup is needed and perform it (Enhanced with backup)
 * Called after memory operations or periodically
 */
export async function checkAndCleanup(): Promise<{
  triggered: boolean;
  deleted: number;
  freedMB: number;
  beforePercent: number;
  afterPercent: number;
  backupPath: string | null;
} | null> {
  try {
    const stats = await getMemoryStats();

    if (stats.storagePercent < CLEANUP_TRIGGER_PERCENT) {
      return null; // No cleanup needed
    }

    logger.warn(`🧹 [Memory] AUTO-CLEANUP TRIGGERED at ${stats.storagePercent.toFixed(1)}% storage`);
    logger.warn(`📦 [Memory] Backing up critical memories before deletion...`);

    // BACKUP FIRST: Export high-value memories that might be deleted
    const backupPath = await exportCriticalMemoriesToBackup();

    const beforePercent = stats.storagePercent;
    let totalDeleted = 0;

    // Delete in priority order until we're back to target
    const deletionPriority = [
      // 1. Forgotten with 0 relevance (user wanted gone + fully decayed)
      `state = 'forgotten' AND relevance_score <= 0`,
      // 2. Faded with 0 relevance (aged out + fully decayed)
      `state = 'faded' AND relevance_score <= 0`,
      // 3. Forgotten by oldest
      `state = 'forgotten' ORDER BY timestamp ASC`,
      // 4. Faded by lowest relevance
      `state = 'faded' ORDER BY relevance_score ASC, timestamp ASC`
    ];

    for (const condition of deletionPriority) {
      // Check current usage
      const currentStats = await getMemoryStats();
      if (currentStats.storagePercent <= CLEANUP_TARGET_PERCENT) {
        break; // We've cleaned enough
      }

      // Calculate how many to delete (batch of 100 at a time)
      const batchSize = 100;

      // Handle ORDER BY clause properly
      const hasOrderBy = condition.includes('ORDER BY');
      const whereClause = hasOrderBy ? condition.split(' ORDER BY')[0] : condition;
      const orderClause = hasOrderBy ? 'ORDER BY ' + condition.split(' ORDER BY')[1] : '';

      const deleteResult = await query<{ id: string }>(`
        DELETE FROM archival_memories
        WHERE id IN (
          SELECT id FROM archival_memories
          WHERE ${whereClause}
          ${orderClause}
          LIMIT $1
        )
        RETURNING id
      `, [batchSize]);

      totalDeleted += deleteResult.length;

      if (deleteResult.length < batchSize) {
        // No more in this category, move to next priority
        continue;
      }
    }

    const afterStats = await getMemoryStats();
    const freedMB = stats.storageUsedMB - afterStats.storageUsedMB;

    logger.info(`🧹 [Memory] Cleanup complete: Deleted ${totalDeleted} memories, freed ${freedMB.toFixed(1)}MB (${beforePercent.toFixed(1)}% → ${afterStats.storagePercent.toFixed(1)}%)`);
    if (backupPath) {
      logger.info(`💾 [Memory] Critical memories backup saved to memory_backups/`);
    }

    return {
      triggered: true,
      deleted: totalDeleted,
      freedMB,
      beforePercent,
      afterPercent: afterStats.storagePercent,
      backupPath
    };
  } catch (error) {
    logger.error('Auto-cleanup failed:', error);
    return null;
  }
}

//--------------------------------------------------------------
// Initialization
//--------------------------------------------------------------

/**
 * Initialize memory manager - ensure DB columns exist
 */
export async function initializeMemoryManager(): Promise<void> {
  try {
    // Add state column if it doesn't exist
    await query(`
      DO $$ BEGIN
        ALTER TABLE archival_memories ADD COLUMN IF NOT EXISTS state VARCHAR(20) DEFAULT 'active';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Add relevance_score column if it doesn't exist
    await query(`
      DO $$ BEGIN
        ALTER TABLE archival_memories ADD COLUMN IF NOT EXISTS relevance_score FLOAT DEFAULT 1.0;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Add last_accessed column if it doesn't exist
    await query(`
      DO $$ BEGIN
        ALTER TABLE archival_memories ADD COLUMN IF NOT EXISTS last_accessed BIGINT;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    // Create index on state for efficient queries
    await query(`
      CREATE INDEX IF NOT EXISTS idx_archival_memories_state ON archival_memories(state);
    `);

    // Create index on relevance_score for decay queries
    await query(`
      CREATE INDEX IF NOT EXISTS idx_archival_memories_relevance ON archival_memories(relevance_score);
    `);

    logger.info('🧠 Memory manager initialized');
  } catch (error) {
    logger.error('Failed to initialize memory manager:', error);
    // Don't throw - allow bot to continue without memory management features
  }
}

//--------------------------------------------------------------
// RP Memory Support
//--------------------------------------------------------------

/**
 * Same functions but for RP memories table
 */
export async function getMemoryStatsRP(): Promise<MemoryStats> {
  try {
    const countResult = await query<{ state: string; count: string }>(`
      SELECT
        COALESCE(state, 'active') as state,
        COUNT(*) as count
      FROM rp_archival_memories
      GROUP BY COALESCE(state, 'active')
    `);

    const byState = {
      active: 0,
      favorite: 0,
      faded: 0,
      forgotten: 0
    };

    let totalMemories = 0;
    for (const row of countResult) {
      const state = row.state as MemoryState;
      const count = parseInt(row.count);
      if (state in byState) {
        byState[state] = count;
      }
      totalMemories += count;
    }

    const avgMemorySizeKB = 8;
    const storageUsedMB = (totalMemories * avgMemorySizeKB) / 1024;

    return {
      totalMemories,
      byState,
      storageUsedMB,
      storageLimitMB: STORAGE_LIMIT_MB,
      storagePercent: (storageUsedMB / STORAGE_LIMIT_MB) * 100
    };
  } catch (error) {
    logger.error('Failed to get RP memory stats:', error);
    return {
      totalMemories: 0,
      byState: { active: 0, favorite: 0, faded: 0, forgotten: 0 },
      storageUsedMB: 0,
      storageLimitMB: STORAGE_LIMIT_MB,
      storagePercent: 0
    };
  }
}

/**
 * Initialize RP memory table columns
 */
export async function initializeMemoryManagerRP(): Promise<void> {
  try {
    await query(`
      DO $$ BEGIN
        ALTER TABLE rp_archival_memories ADD COLUMN IF NOT EXISTS state VARCHAR(20) DEFAULT 'active';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    await query(`
      DO $$ BEGIN
        ALTER TABLE rp_archival_memories ADD COLUMN IF NOT EXISTS relevance_score FLOAT DEFAULT 1.0;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    await query(`
      DO $$ BEGIN
        ALTER TABLE rp_archival_memories ADD COLUMN IF NOT EXISTS last_accessed BIGINT;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_rp_archival_memories_state ON rp_archival_memories(state);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_rp_archival_memories_relevance ON rp_archival_memories(relevance_score);
    `);

    logger.info('🧠 RP Memory manager initialized');
  } catch (error) {
    logger.error('Failed to initialize RP memory manager:', error);
  }
}

//--------------------------------------------------------------
// Daily Decay Check (called from heartbeat)
//--------------------------------------------------------------

let lastDecayCheck: number = 0;
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check if daily decay should run, and run it if so.
 * Called from heartbeat processor - only runs once per 24 hours.
 */
export async function checkDailyDecay(): Promise<void> {
  const now = Date.now();

  // Skip if less than 24 hours since last check
  if (now - lastDecayCheck < DECAY_INTERVAL_MS) {
    return;
  }

  logger.info('🧠 Running daily memory decay check...');
  lastDecayCheck = now;

  try {
    // Apply decay to regular memories (fading curve)
    const regularDecay = await applyMemoryDecay();

    // RP memories don't decay (Option A - stay at full strength)
    await applyMemoryDecayRP(); // No-op for RP, but kept for consistency

    logger.info(`🧠 Decay complete: Regular=${regularDecay.decayed} decayed/${regularDecay.faded} faded, RP=skipped (no fading)`);

    // Check regular memory storage warnings (75%, 80%, 85%)
    await checkStorageWarnings();

    // Check if cleanup is needed after decay (regular memories)
    const cleanupResult = await checkAndCleanup();
    if (cleanupResult?.triggered) {
      logger.warn(`🧹 [Memory] Cleanup: Deleted ${cleanupResult.deleted} memories${cleanupResult.backupPath ? ', backup saved' : ''}`);
    }

    // Check RP storage warnings (75%, 80%, 85%)
    await checkRPStorageWarnings();

    // Check if RP channel cleanup is needed (90% threshold - with backup)
    const rpCleanupResult = await cleanupOldRPChannels();
    if (rpCleanupResult?.triggered) {
      logger.warn(`🧹 [RP] Channel cleanup: Deleted ${rpCleanupResult.channelsDeleted} channels (${rpCleanupResult.memoriesDeleted} memories), ${rpCleanupResult.backupPaths.length} backups saved`);
    }
  } catch (error) {
    logger.error('Daily decay check failed:', error);
  }
}

/**
 * Get current decay rate
 */
export function getDecayRate(): number {
  return DECAY_RATE;
}

/**
 * Set decay rate (AI-controllable memory management)
 * @param rate Daily decay rate (0.0 = no decay, 0.1 = rapid decay)
 * @returns The clamped rate that was actually set
 */
export function setDecayRate(rate: number): number {
  // Clamp to safe range
  const clampedRate = Math.max(0.0, Math.min(0.1, rate));
  DECAY_RATE = clampedRate;
  logger.info(`🧠 Memory decay rate updated: ${clampedRate} (was ${DECAY_RATE})`);
  return clampedRate;
}

/**
 * Option A: RP memories don't fade - they stay at full strength
 * Instead of decaying, we delete entire old channels when storage is full
 * This is cleaner: fiction doesn't "fade", you either remember the story or archive it
 */
async function applyMemoryDecayRP(): Promise<{
  decayed: number;
  faded: number;
}> {
  // RP memories don't decay - they stay fresh
  // Cleanup happens via channel-based deletion when storage is full
  logger.info('🎭 RP memories skip decay - staying at full strength');
  return { decayed: 0, faded: 0 };
}

/**
 * Check RP storage and emit warnings at thresholds
 * Warns at 75%, 80%, 85% to give user time to manually archive
 */
export async function checkRPStorageWarnings(): Promise<void> {
  try {
    const stats = await getMemoryStatsRP();
    const currentPercent = stats.storagePercent;

    // Find the highest threshold crossed
    let highestCrossed = 0;
    for (const threshold of RP_WARNING_THRESHOLDS) {
      if (currentPercent >= threshold) {
        highestCrossed = threshold;
      }
    }

    // Only warn if we've crossed a new threshold
    if (highestCrossed > lastRPWarningLevel) {
      lastRPWarningLevel = highestCrossed;

      const emoji = highestCrossed >= 85 ? '🔴' : highestCrossed >= 80 ? '🟡' : '🟢';
      logger.warn(`${emoji} [RP] Storage at ${currentPercent.toFixed(1)}% (${stats.storageUsedMB.toFixed(0)}MB / ${(stats.storageLimitMB / 1024).toFixed(1)}GB)`);
      logger.warn(`⚠️  [RP] Approaching cleanup threshold (90%). Consider manually archiving old RP channels.`);

      if (highestCrossed >= 85) {
        logger.warn(`🚨 [RP] CRITICAL: Storage at 85%+. Auto-cleanup will delete oldest channels at 90%.`);
      }
    }
  } catch (error) {
    logger.error('[RP] Storage warning check failed:', error);
  }
}

/**
 * Export RP channel memories to JSON backup before deletion
 * Returns the backup file path
 */
async function exportRPChannelToBackup(channelId: string): Promise<string | null> {
  try {
    const memories = await query(`
      SELECT
        content, category, importance, message_weight as "messageWeight",
        timestamp, tags, metadata, state
      FROM rp_archival_memories
      WHERE tags @> jsonb_build_array($1::text)
      ORDER BY timestamp ASC
    `, [channelId]);

    if (memories.length === 0) {
      return null;
    }

    // Create backup directory
    const backupDir = path.join(process.cwd(), 'data', 'rp_backups');
    await fs.mkdir(backupDir, { recursive: true });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `rp_channel_${channelId}_${timestamp}.json`;
    const backupPath = path.join(backupDir, filename);

    // Write backup
    await fs.writeFile(backupPath, JSON.stringify(memories, null, 2));

    logger.info(`💾 [RP] Exported ${memories.length} memories from channel ${channelId} to ${filename}`);
    return backupPath;
  } catch (error) {
    logger.error(`[RP] Failed to export channel ${channelId}:`, error);
    return null;
  }
}

/**
 * Channel-based cleanup for RP memories (Enhanced)
 * - Exports channels to JSON backup before deletion
 * - Deletes entire old RP channels when storage is full
 * - Channels are identified by channel_id in tags array
 */
export async function cleanupOldRPChannels(): Promise<{
  triggered: boolean;
  channelsDeleted: number;
  memoriesDeleted: number;
  freedMB: number;
  beforePercent: number;
  afterPercent: number;
  backupPaths: string[];
} | null> {
  try {
    const stats = await getMemoryStatsRP();

    if (stats.storagePercent < CLEANUP_TRIGGER_PERCENT) {
      return null; // No cleanup needed
    }

    logger.warn(`🧹 [RP] AUTO-CLEANUP TRIGGERED at ${stats.storagePercent.toFixed(1)}% storage`);
    logger.warn(`📦 [RP] Exporting channels to backup before deletion...`);

    const beforePercent = stats.storagePercent;
    let totalDeleted = 0;
    let channelsDeleted = 0;
    const backupPaths: string[] = [];

    // Get all RP channels with their last interaction timestamp
    interface ChannelInfo {
      channelId: string;
      memoryCount: number;
      lastTimestamp: number;
    }

    const channels = await query<ChannelInfo>(`
      SELECT
        tags[2] as "channelId",
        COUNT(*) as "memoryCount",
        MAX(timestamp) as "lastTimestamp"
      FROM rp_archival_memories
      WHERE array_length(tags, 1) >= 2
      GROUP BY tags[2]
      ORDER BY MAX(timestamp) ASC
    `);

    if (channels.length === 0) {
      logger.warn('🎭 [RP] No channels found for cleanup');
      return null;
    }

    logger.info(`🎭 [RP] Found ${channels.length} channels to evaluate for cleanup`);

    // Delete channels from oldest to newest until we hit target
    for (const channel of channels) {
      // Check current usage
      const currentStats = await getMemoryStatsRP();
      if (currentStats.storagePercent <= CLEANUP_TARGET_PERCENT) {
        break; // We've cleaned enough
      }

      const lastInteraction = new Date(channel.lastTimestamp).toISOString().split('T')[0];

      // EXPORT FIRST: Create backup before deletion
      logger.info(`💾 [RP] Backing up channel ${channel.channelId} (${channel.memoryCount} memories, last active: ${lastInteraction})...`);
      const backupPath = await exportRPChannelToBackup(channel.channelId);
      if (backupPath) {
        backupPaths.push(backupPath);
      }

      // NOW DELETE: Remove all memories from this channel
      const deleteResult = await query<{ id: string }>(`
        DELETE FROM rp_archival_memories
        WHERE tags @> jsonb_build_array($1::text)
        RETURNING id
      `, [channel.channelId]);

      const deleted = deleteResult.length;
      totalDeleted += deleted;
      channelsDeleted++;

      logger.warn(`🗑️ [RP] Deleted channel ${channel.channelId} (${deleted} memories)${backupPath ? ` → Backup saved` : ''}`);
    }

    const afterStats = await getMemoryStatsRP();
    const freedMB = stats.storageUsedMB - afterStats.storageUsedMB;

    logger.info(`🧹 [RP] Cleanup complete: Deleted ${channelsDeleted} channels (${totalDeleted} memories), freed ${freedMB.toFixed(1)}MB (${beforePercent.toFixed(1)}% → ${afterStats.storagePercent.toFixed(1)}%)`);
    if (backupPaths.length > 0) {
      logger.info(`💾 [RP] ${backupPaths.length} backup(s) saved to data/rp_backups/`);
    }

    return {
      triggered: true,
      channelsDeleted,
      memoriesDeleted: totalDeleted,
      freedMB,
      beforePercent,
      afterPercent: afterStats.storagePercent,
      backupPaths
    };
  } catch (error) {
    logger.error('[RP] Channel cleanup failed:', error);
    return null;
  }
}
