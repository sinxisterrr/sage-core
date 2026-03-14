//--------------------------------------------------------------
// FILE: src/memory/continuumSTM.ts
// Simple STM with dynamic sizing based on context window
// Now with database persistence for crash recovery
//--------------------------------------------------------------

import { Message, TextChannel } from 'discord.js';
import { query } from '../db/db.js';
import { getAIName, getUserName } from '../utils/pronouns.js';

export interface STMEntry {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
  ephemeral?: boolean; // If true, don't archive to LTM when aging out
}

// Per-user STM buffers
const STM_BUFFERS: Record<string, STMEntry[]> = {};

// Calculate max STM size based on context window
// Optimized for 260k context with 200k allocated to LTM retrieval
function calculateMaxSTMSize(): number {
  const contextLength = parseInt(process.env.CONTEXT_LENGTH || '260000');

  // Realistic token allocation:
  // - Fixed overhead: ~1,500 tokens
  // - User message: ~500 tokens
  // - LTM retrieval: ~200,000 tokens (persona/human/archival)
  // - STM: ~50,000 tokens (remaining)
  // - Output buffer: ~8,000 tokens

  const avgTokensPerMessage = 125; // Real-world average for conversation
  const tokensForSTM = 50000; // Fixed budget for STM
  const maxMessages = Math.floor(tokensForSTM / avgTokensPerMessage);

  // Minimum 50, maximum 500 messages
  return Math.max(50, Math.min(500, maxMessages));
}

let MAX_STM_SIZE = calculateMaxSTMSize();

// Recalculate if context length changes
export function updateSTMSize() {
  MAX_STM_SIZE = calculateMaxSTMSize();
  console.log(`📊 STM size recalculated: ${MAX_STM_SIZE} messages (context: ${process.env.CONTEXT_LENGTH})`);
}

export function getMaxSTMSize(): number {
  return MAX_STM_SIZE;
}

export function addToSTM(userId: string, role: 'user' | 'assistant', text: string, ephemeral: boolean = false): STMEntry {
  if (!STM_BUFFERS[userId]) {
    STM_BUFFERS[userId] = [];
  }

  const entry: STMEntry = {
    role,
    text,
    timestamp: Date.now(),
    ephemeral
  };

  STM_BUFFERS[userId].push(entry);

  const currentSize = STM_BUFFERS[userId].length;
  const ephemeralTag = ephemeral ? ' [ephemeral]' : '';
  console.log(`📝 Added to STM [${role}]${ephemeralTag} (${currentSize}/${MAX_STM_SIZE} messages) - User: ${userId}`);

  // Save to database (async, don't wait - fail silently if DB unavailable)
  if (!ephemeral) {
    saveSTMToDB(userId, entry).catch(err => {
      console.error('Failed to save STM to DB (non-critical):', err.message);
    });
  }

  return entry;
}

export function getSTM(userId: string): STMEntry[] {
  return STM_BUFFERS[userId] ? [...STM_BUFFERS[userId]] : [];
}

export function getSTMSize(userId: string): number {
  return STM_BUFFERS[userId] ? STM_BUFFERS[userId].length : 0;
}

export function shouldArchive(userId: string): boolean {
  return getSTMSize(userId) > MAX_STM_SIZE;
}

export function getOldestForArchival(userId: string, count: number): STMEntry[] {
  if (!STM_BUFFERS[userId]) return [];

  // Archive the oldest messages (removed from in-memory STM and DB STM)
  const toRemove = Math.min(count, STM_BUFFERS[userId].length);
  const removed = STM_BUFFERS[userId].splice(0, toRemove);

  // Delete from database (async, don't wait)
  if (removed.length > 0) {
    const timestamps = removed.map(e => e.timestamp);
    deleteSTMFromDB(userId, timestamps).catch(err => {
      console.error('Failed to delete archived STM from DB (non-critical):', err.message);
    });
  }

  return removed;
}

export function clearSTM(userId: string) {
  STM_BUFFERS[userId] = [];

  // Clear from database too (async, don't wait)
  clearSTMFromDB(userId).catch(err => {
    console.error('Failed to clear STM from DB (non-critical):', err.message);
  });
}

/**
 * Format STM with human-readable timestamps for context-aware processing
 * ALL STM views include timestamps so AI can see WHEN things were said
 * Timestamps are NOT stored in entry.text - they're added at display time
 * LTM archival uses entry.text directly, so timestamps stay out of long-term memory
 */
export function formatSTMForPrompt(entries: STMEntry[]): string {
  const timezone = process.env.TIMEZONE || 'America/Denver';

  return entries.map(e => {
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
}

// Alias for backward compatibility
export const formatSTMWithTimestamps = formatSTMForPrompt;

//--------------------------------------------------------------
// Database Persistence Functions
//--------------------------------------------------------------

/**
 * Save STM entry to database
 */
async function saveSTMToDB(userId: string, entry: STMEntry): Promise<void> {
  await query(`
    INSERT INTO stm (user_id, role, content, timestamp)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT DO NOTHING
  `, [userId, entry.role, entry.text, entry.timestamp]);
}

/**
 * Load STM from database for a user
 */
async function loadSTMFromDB(userId: string): Promise<STMEntry[]> {
  const result = await query<{ role: 'user' | 'assistant'; content: string; timestamp: string }>(`
    SELECT role, content, timestamp
    FROM stm
    WHERE user_id = $1
    ORDER BY timestamp ASC
  `, [userId]);

  return result.map(row => ({
    role: row.role,
    text: row.content,
    timestamp: parseInt(row.timestamp)
  }));
}

/**
 * Delete specific STM entries from database (when archived)
 */
async function deleteSTMFromDB(userId: string, timestamps: number[]): Promise<void> {
  if (timestamps.length === 0) return;

  await query(`
    DELETE FROM stm
    WHERE user_id = $1 AND timestamp = ANY($2)
  `, [userId, timestamps]);
}

/**
 * Clear all STM entries for a user from database
 */
async function clearSTMFromDB(userId: string): Promise<void> {
  await query(`
    DELETE FROM stm WHERE user_id = $1
  `, [userId]);
}

/**
 * Load STM from database first, fallback to Discord channel history if empty
 * Called when STM is empty for a user/channel (e.g., after redeploy)
 */
export async function loadSTMFromChannel(
  channel: TextChannel,
  userId: string,
  botId: string
): Promise<void> {
  try {
    // Check if STM is already populated
    if (STM_BUFFERS[userId] && STM_BUFFERS[userId].length > 0) {
      console.log(`📂 STM already loaded for user ${userId}`);
      return;
    }

    // Try loading from database first
    console.log(`🔄 STM empty - attempting to load from database for user ${userId}...`);
    try {
      const dbEntries = await loadSTMFromDB(userId);
      if (dbEntries.length > 0) {
        STM_BUFFERS[userId] = dbEntries;
        console.log(`✅ STM recovered from database! Loaded ${dbEntries.length} messages`);
        return;
      }
    } catch (dbErr: any) {
      console.warn(`⚠️ Database load failed, falling back to Discord history: ${dbErr.message}`);
    }

    // Fallback: Load from Discord channel history
    console.log(`🔄 Loading last 30 messages from Discord channel history for user ${userId}...`);

    const messages = await channel.messages.fetch({ limit: 30 });
    const sortedMessages = Array.from(messages.values()).reverse(); // Oldest first

    const entries: STMEntry[] = [];

    for (const msg of sortedMessages) {
      // Skip system messages
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

    // Initialize STM buffer with channel history
    STM_BUFFERS[userId] = entries;
    console.log(`✅ STM recovered from Discord! Loaded ${entries.length} messages`);

    // Save to database for next time
    for (const entry of entries) {
      await saveSTMToDB(userId, entry).catch(() => {}); // Ignore errors
    }
  } catch (err) {
    console.error('Failed to load STM:', err);
  }
}
