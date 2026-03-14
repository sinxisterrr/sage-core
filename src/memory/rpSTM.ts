//--------------------------------------------------------------
// FILE: src/memory/rpSTM.ts
// RP STM with dynamic sizing based on context window
// Identical to continuumSTM but for RP channels
// Now with database persistence for crash recovery
//--------------------------------------------------------------

import { Message, TextChannel } from 'discord.js';
import { query } from '../db/db.js';
import { getAIName, getUserName } from '../utils/pronouns.js';

export interface STMEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

// Per-user-channel RP STM buffers (keyed by "userId-channelId" to separate conversations by channel)
const RP_STM_BUFFERS: Record<string, STMEntry[]> = {};

/**
 * Create a composite key from userId and channelId
 * This ensures each channel has its own separate conversation memory
 */
function makeMemoryKey(userId: string, channelId: string): string {
  return `${userId}-${channelId}`;
}

// Calculate max STM size based on context window
function calculateMaxSTMSize(): number {
  const contextLength = parseInt(process.env.CONTEXT_LENGTH || '260000');
  const avgTokensPerMessage = 125;
  const tokensForSTM = 50000;
  const maxMessages = Math.floor(tokensForSTM / avgTokensPerMessage);
  return Math.max(50, Math.min(500, maxMessages));
}

let MAX_STM_SIZE = calculateMaxSTMSize();

export function updateSTMSize() {
  MAX_STM_SIZE = calculateMaxSTMSize();
  console.log(`📊 [RP] STM size recalculated: ${MAX_STM_SIZE} messages (context: ${process.env.CONTEXT_LENGTH})`);
}

export function getMaxSTMSize(): number {
  return MAX_STM_SIZE;
}

export function addToSTM(userId: string, channelId: string, role: 'user' | 'assistant', text: string): STMEntry {
  const key = makeMemoryKey(userId, channelId);

  if (!RP_STM_BUFFERS[key]) {
    RP_STM_BUFFERS[key] = [];
  }

  const entry: STMEntry = {
    role,
    text,
    timestamp: Date.now()
  };

  RP_STM_BUFFERS[key].push(entry);

  const currentSize = RP_STM_BUFFERS[key].length;
  console.log(`🎭 [RP] Added to STM [${role}] (${currentSize}/${MAX_STM_SIZE} messages) - User: ${userId}, Channel: ${channelId}`);

  // Save to database (async, don't wait - fail silently if DB unavailable)
  saveSTMToDB(userId, channelId, entry).catch(err => {
    console.error('[RP] Failed to save STM to DB (non-critical):', err.message);
  });

  return entry;
}

export function getSTM(userId: string, channelId: string): STMEntry[] {
  const key = makeMemoryKey(userId, channelId);
  return RP_STM_BUFFERS[key] ? [...RP_STM_BUFFERS[key]] : [];
}

export function getSTMSize(userId: string, channelId: string): number {
  const key = makeMemoryKey(userId, channelId);
  return RP_STM_BUFFERS[key] ? RP_STM_BUFFERS[key].length : 0;
}

export function shouldArchive(userId: string, channelId: string): boolean {
  return getSTMSize(userId, channelId) > MAX_STM_SIZE;
}

export function getOldestForArchival(userId: string, channelId: string, count: number): STMEntry[] {
  const key = makeMemoryKey(userId, channelId);
  if (!RP_STM_BUFFERS[key]) return [];
  const toRemove = Math.min(count, RP_STM_BUFFERS[key].length);
  const removed = RP_STM_BUFFERS[key].splice(0, toRemove);

  // Delete from database (async, don't wait)
  if (removed.length > 0) {
    const timestamps = removed.map(e => e.timestamp);
    deleteSTMFromDB(userId, channelId, timestamps).catch(err => {
      console.error('[RP] Failed to delete archived STM from DB (non-critical):', err.message);
    });
  }

  return removed;
}

export function clearSTM(userId: string, channelId: string) {
  const key = makeMemoryKey(userId, channelId);
  RP_STM_BUFFERS[key] = [];

  // Clear from database too (async, don't wait)
  clearSTMFromDB(userId, channelId).catch(err => {
    console.error('[RP] Failed to clear STM from DB (non-critical):', err.message);
  });
}

/**
 * Format RP STM with timestamps so AI can see WHEN things were said
 * Timestamps are added at display time, not stored in entry.text
 */
export function formatSTMForPrompt(entries: STMEntry[]): string {
  const timezone = process.env.TIMEZONE || 'America/Denver';

  // HARD-CODED: Mark as narrative roleplay
  const formatted = entries.map(e => {
    const role = e.role === 'user' ? getUserName() : getAIName();
    const entryDate = new Date(e.timestamp);

    // Format time in 24-hour format (e.g., "14:30")
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const timeStr = timeFormatter.format(entryDate);

    // Format date as: "Weekday, Month Day, Year" (e.g., "Thursday, January 23, 2026")
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
    const dayLabel = dateFormatter.format(entryDate);

    return `[${dayLabel} at ${timeStr}] ${role}: ${e.text}`;
  }).join('\n\n');

  return `## ACTIVE ROLEPLAY SCENE (NARRATIVE - NOT REAL LIFE)\n\n${formatted}`;
}

//--------------------------------------------------------------
// Database Persistence Functions
//--------------------------------------------------------------

/**
 * Save RP STM entry to database
 * Note: We store channelId as metadata since RP STM is per-channel
 */
async function saveSTMToDB(userId: string, channelId: string, entry: STMEntry): Promise<void> {
  await query(`
    INSERT INTO rp_stm (user_id, role, content, timestamp)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
  `, [makeMemoryKey(userId, channelId), entry.role, entry.text, entry.timestamp]);
}

/**
 * Load RP STM from database for a user/channel
 */
async function loadSTMFromDB(userId: string, channelId: string): Promise<STMEntry[]> {
  const result = await query<{ role: 'user' | 'assistant'; content: string; timestamp: string }>(`
    SELECT role, content, timestamp
    FROM rp_stm
    WHERE user_id = $1
    ORDER BY timestamp ASC
  `, [makeMemoryKey(userId, channelId)]);

  return result.map(row => ({
    role: row.role,
    text: row.content,
    timestamp: parseInt(row.timestamp)
  }));
}

/**
 * Delete specific RP STM entries from database (when archived)
 */
async function deleteSTMFromDB(userId: string, channelId: string, timestamps: number[]): Promise<void> {
  if (timestamps.length === 0) return;

  await query(`
    DELETE FROM rp_stm
    WHERE user_id = $1 AND timestamp = ANY($2)
  `, [makeMemoryKey(userId, channelId), timestamps]);
}

/**
 * Clear all RP STM entries for a user/channel from database
 */
async function clearSTMFromDB(userId: string, channelId: string): Promise<void> {
  await query(`
    DELETE FROM rp_stm WHERE user_id = $1
  `, [makeMemoryKey(userId, channelId)]);
}

/**
 * Load RP STM from database first, fallback to Discord channel history if empty
 * Called when RP STM is empty for a user/channel (e.g., after redeploy)
 */
export async function loadSTMFromChannel(
  channel: TextChannel,
  userId: string,
  channelId: string,
  botId: string
): Promise<void> {
  try {
    const key = makeMemoryKey(userId, channelId);

    if (RP_STM_BUFFERS[key] && RP_STM_BUFFERS[key].length > 0) {
      console.log(`📂 [RP] STM already loaded for user ${userId} in channel ${channelId}`);
      return;
    }

    // Try loading from database first
    console.log(`🔄 [RP] STM empty - attempting to load from database for user ${userId} in channel ${channelId}...`);
    try {
      const dbEntries = await loadSTMFromDB(userId, channelId);
      if (dbEntries.length > 0) {
        RP_STM_BUFFERS[key] = dbEntries;
        console.log(`✅ [RP] STM recovered from database! Loaded ${dbEntries.length} messages`);
        return;
      }
    } catch (dbErr: any) {
      console.warn(`⚠️ [RP] Database load failed, falling back to Discord history: ${dbErr.message}`);
    }

    // Fallback: Load from Discord channel history
    console.log(`🔄 [RP] Loading last 30 messages from Discord channel history for user ${userId} in channel ${channelId}...`);

    const messages = await channel.messages.fetch({ limit: 30 });
    const sortedMessages = Array.from(messages.values()).reverse();

    const entries: STMEntry[] = [];

    for (const msg of sortedMessages) {
      if (msg.author.system) continue;
      const role = msg.author.id === botId ? 'assistant' : 'user';
      const text = msg.content;
      if (!text || text.trim().length === 0) continue;

      entries.push({
        role,
        text,
        timestamp: msg.createdTimestamp
      });
    }

    RP_STM_BUFFERS[key] = entries;
    console.log(`✅ [RP] STM recovered from Discord! Loaded ${entries.length} messages for channel ${channelId}`);

    // Save to database for next time
    for (const entry of entries) {
      await saveSTMToDB(userId, channelId, entry).catch(() => {}); // Ignore errors
    }
  } catch (err) {
    console.error('[RP] Failed to load STM:', err);
  }
}
