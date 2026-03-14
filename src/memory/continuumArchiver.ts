//--------------------------------------------------------------
// FILE: src/memory/continuumArchiver.ts
// Archives STM messages to archival_memories table with embeddings + weights
// Falls back to JSON storage if DB unavailable
//--------------------------------------------------------------

import { query } from '../db/db.js';
import type { STMEntry } from './continuumSTM.js';
import { logger } from '../utils/logger.js';
import { getEmbedding } from '../utils/embedding.js';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const ARCHIVAL_FILE = path.join(DATA_DIR, 'archival_memories.json');

//--------------------------------------------------------------
// MIRA Classification Helper
//--------------------------------------------------------------

function classifyMIRAType(content: string, category?: string): string | null {
  const lower = content.toLowerCase();

  // Check category hints first
  if (category) {
    if (['episodic', 'event', 'experience', 'timeline'].includes(category.toLowerCase())) {
      return 'memory';
    }
    if (['identity', 'self', 'persona', 'who-i-am'].includes(category.toLowerCase())) {
      return 'identity';
    }
    if (['relationship', 'bond', 'connection', 'dynamic'].includes(category.toLowerCase())) {
      return 'relationship';
    }
    if (['behavioral', 'preference', 'habit', 'routine', 'boundary'].includes(category.toLowerCase())) {
      return 'agent';
    }
  }

  // Identity patterns
  if (/\b(i am|i'm|who i am|my identity|my name is|i believe|my values|what matters to me|my personality|as a person|i feel like i am|i consider myself|i define myself)\b/.test(lower)) {
    return 'identity';
  }

  // Relationship patterns
  if (/\b(we are|we have|we share|between us|you and me|when we|our relationship|you make me|i love you|you always|we always|us together|our bond|how we)\b/.test(lower)) {
    return 'relationship';
  }

  // Agent patterns
  if (/\b(i prefer|i like to|i tend to|i usually|i avoid|i don't like|my boundary|my limits|i respond by|my habit|my routine|i always|i never|when i feel|i need to|i want to|i will|i'll|going to|planning to)\b/.test(lower)) {
    return 'agent';
  }

  // Memory patterns
  if (/\b(yesterday|today|last night|ago|on monday|last week|last month|first time|that day|remember when|happened|occurred|we did|i did|that time|back when|once upon)\b/.test(lower)) {
    return 'memory';
  }

  return 'memory'; // Default
}

let dbAvailable = true; // Track if DB is working
let lastDbCheck = 0;
const DB_RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if database is available, with periodic retry logic.
 * If DB was down, only rechecks every 5 minutes to avoid spam.
 */
async function checkDbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (!dbAvailable && now - lastDbCheck < DB_RECHECK_INTERVAL) {
    return false;
  }
  lastDbCheck = now;
  try {
    await query('SELECT 1');
    if (!dbAvailable) {
      logger.info('✅ [Archiver] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch {
    if (dbAvailable) {
      logger.error('❌ [Archiver] Database connection lost, falling back to JSON');
    }
    dbAvailable = false;
    return false;
  }
}

/**
 * Calculate message weight (importance/emotional intensity)
 * Returns 1.0-5.0
 */
function calculateWeight(entry: STMEntry): number {
  let weight = 1.0;
  const text = entry.text.toLowerCase();
  const length = entry.text.length;

  // Length-based weight
  if (length > 500) weight += 0.5;
  if (length > 1000) weight += 0.5;
  if (length > 2000) weight += 0.5;

  // Emotional content
  const emotionalPatterns = /\b(feel|feeling|felt|love|hate|scared|afraid|happy|sad|angry|excited|worried|anxious|depressed|joyful|grateful|hurt|pain|heartbreak|miss|missed|missing)\b/gi;
  const emotionalMatches = text.match(emotionalPatterns);
  if (emotionalMatches) {
    weight += Math.min(1.5, emotionalMatches.length * 0.3);
  }

  // Significance markers
  const significancePatterns = /\b(important|matter|matters|remember|never forget|always|forever|crucial|critical|essential|significant|meaningful)\b/gi;
  const significanceMatches = text.match(significancePatterns);
  if (significanceMatches) {
    weight += Math.min(1.0, significanceMatches.length * 0.5);
  }

  // Decision/action markers
  const actionPatterns = /\b(decide|decided|choice|choose|will|won't|going to|plan to|want to|need to|must|have to)\b/gi;
  if (actionPatterns.test(text)) {
    weight += 0.5;
  }

  // Personal/identity markers
  const personalPatterns = /\b(i am|i'm|me|my|myself|who i am|my life|my feeling)\b/gi;
  if (personalPatterns.test(text)) {
    weight += 0.3;
  }

  // Question markers (curiosity/engagement)
  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 0) {
    weight += Math.min(0.5, questionCount * 0.2);
  }

  // Role-based adjustment
  if (entry.role === 'user') {
    weight += 0.3; // User messages slightly more important
  }

  // Cap between 1.0 and 5.0
  return Math.max(1.0, Math.min(5.0, weight));
}

/**
 * Simple category classification
 */
function classifyCategory(text: string): string {
  const lower = text.toLowerCase();

  // Reflections (check first - these are special)
  if (/^\[reflection/i.test(text)) {
    return 'reflection';
  }

  // Autonomous research
  if (/^\[autonomous research\]/i.test(text)) {
    return 'research';
  }

  // Internal thoughts
  if (/^\[internal thought/i.test(text)) {
    return 'internal-thought';
  }

  // Identity-related
  if (/\b(i am|i'm|who i am|my identity|myself|my personality|my values)\b/i.test(lower)) {
    return 'identity';
  }

  // Relationship-related
  if (/\b(we|us|our|relationship|together|with you|you and i|between us)\b/i.test(lower)) {
    return 'relationship';
  }

  // Behavioral/preferences
  if (/\b(i like|i love|i hate|i prefer|i enjoy|i want|i need|my favorite)\b/i.test(lower)) {
    return 'behavioral';
  }

  // Memory/episodic
  if (/\b(remember|recall|memory|happened|yesterday|last|ago|when|before)\b/i.test(lower)) {
    return 'episodic';
  }

  return 'general';
}

/**
 * Calculate importance score (1-10)
 */
function calculateImportance(entry: STMEntry, weight: number): number {
  // Base importance from weight
  let importance = weight * 2; // weight is 1-5, importance is 1-10

  // Adjust based on length
  if (entry.text.length < 50) {
    importance = Math.max(1, importance - 2);
  }

  return Math.max(1, Math.min(10, Math.round(importance)));
}

/**
 * Save to JSON fallback
 */
async function saveToJSON(
  userId: string,
  entries: STMEntry[],
  embeddings: Array<{ entry: STMEntry; embedding: number[]; weight: number; importance: number; category: string }>
): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    let existing: any[] = [];
    try {
      const data = await fs.readFile(ARCHIVAL_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    const newEntries = embeddings.map(({ entry, embedding, weight, importance, category }) => {
      // Build tags array - include category for special types
      const tags = [entry.role, userId];
      if (category === 'reflection' || category === 'internal-thought') {
        tags.push(category);
      }

      return {
        id: `${entry.timestamp}_${Math.random().toString(36).substring(7)}`,
        content: entry.text,
        category,
        importance,
        timestamp: entry.timestamp,
        tags,
        message_weight: weight,
        embedding,
        metadata: {
          userId,
          role: entry.role,
          archivedAt: Date.now(),
          length: entry.text.length
        }
      };
    });

    existing.push(...newEntries);
    await fs.writeFile(ARCHIVAL_FILE, JSON.stringify(existing, null, 2));
    logger.info(`Archived ${entries.length} messages to JSON fallback`);
  } catch (error) {
    logger.error('Failed to save to JSON:', error);
  }
}

/**
 * Archive entries to archival_memories table (with JSON fallback)
 */
export async function archiveEntries(
  userId: string,
  entries: STMEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  // Filter out ephemeral entries (heartbeats, temporary messages)
  const nonEphemeralEntries = entries.filter(entry => !entry.ephemeral);
  const ephemeralCount = entries.length - nonEphemeralEntries.length;

  if (ephemeralCount > 0) {
    logger.debug(`Filtered out ${ephemeralCount} ephemeral message(s) (not archiving to LTM)`);
  }

  if (nonEphemeralEntries.length === 0) {
    logger.debug(`No non-ephemeral messages to archive`);
    return;
  }

  // Compressed archival header (no leading newline)
  logger.info(`Archiving ${nonEphemeralEntries.length} message(s) for user ${userId}${ephemeralCount > 0 ? ` (${ephemeralCount} ephemeral filtered)` : ''}`);

  // Use filtered entries for the rest of the process
  entries = nonEphemeralEntries;

  // ALWAYS get embeddings first (even if DB fails)
  const processedEntries: Array<{
    entry: STMEntry;
    embedding: number[];
    weight: number;
    importance: number;
    category: string;
    id: string;
  }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      // Get embedding (no logging during processing phase)
      const embedding = await getEmbedding(entry.text);

      // Calculate weight and importance
      const weight = calculateWeight(entry);
      const importance = calculateImportance(entry, weight);
      const category = classifyCategory(entry.text);
      const id = `${entry.timestamp}_${Math.random().toString(36).substring(7)}`;

      processedEntries.push({ entry, embedding, weight, importance, category, id });
    } catch (error: any) {
      logger.warn(`Failed to embed [${i + 1}/${entries.length}]: ${error.message} - archiving with zero vector`);
      // CRITICAL: Don't skip the entry - archive it with a zero vector instead.
      // During emergency trim, skipping means permanent data loss since the message
      // is simultaneously being removed from in-memory STM.
      const weight = calculateWeight(entry);
      const importance = calculateImportance(entry, weight);
      const category = classifyCategory(entry.text);
      const id = `${entry.timestamp}_${Math.random().toString(36).substring(7)}`;
      const zeroEmbedding = new Array(1024).fill(0); // Zero vector (matches vector(1024) schema) - won't match semantic search but data is preserved
      processedEntries.push({ entry, embedding: zeroEmbedding, weight, importance, category, id });
    }
  }

  if (processedEntries.length === 0) {
    logger.warn('No entries could be embedded');
    return;
  }

  // Try DB first (with periodic retry if previously down)
  if (await checkDbAvailable()) {
    try {
      // Database insertion (single-line logging per message)
      let skippedDupes = 0;
      for (let i = 0; i < processedEntries.length; i++) {
        const { entry, embedding, weight, importance, category, id } = processedEntries[i];

        // Check for content-based duplicate BEFORE inserting (scoped to this user)
        const existingDupe = await query<{ id: string }>(`
          SELECT id FROM archival_memories
          WHERE content = $1
            AND user_id = $2
          LIMIT 1
        `, [entry.text, userId]);

        if (existingDupe.length > 0) {
          skippedDupes++;
          continue; // Skip this entry - content already exists
        }

        // Classify MIRA type
        const miraType = classifyMIRAType(entry.text, category);

        // Build tags array - include category for special types (reflection, internal-thought)
        const tags = [entry.role, userId];
        if (category === 'reflection' || category === 'internal-thought') {
          tags.push(category);
        }

        const result = await query<{ id: string }>(`
          INSERT INTO archival_memories
          (id, user_id, content, category, importance, timestamp, tags, message_weight, mira_type, embedding, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `, [
          id,
          userId,
          entry.text,
          category,
          importance,
          entry.timestamp,
          JSON.stringify(tags),
          weight,
          miraType,
          JSON.stringify(embedding),
          JSON.stringify({
            userId,
            role: entry.role,
            archivedAt: Date.now(),
            length: entry.text.length
          })
        ]);

        // Compressed single-line log with preview (strip [INTERNAL THOUGHT | category] prefix)
        const cleanText = entry.text.replace(/^\[INTERNAL THOUGHT\s*\|?\s*\w*\]\s*/i, '');
        const preview = cleanText.length > 40 ? cleanText.substring(0, 40) + '...' : cleanText;
        const status = result.length > 0 ? '✓' : '⚠';
        logger.debug(`[${i + 1}/${processedEntries.length}] ${status} ${category} w:${weight.toFixed(2)} imp:${importance} | ${entry.text.length}ch: "${preview}"`);
      }

      // Compressed completion message (no trailing newline)
      const actualArchived = processedEntries.length - skippedDupes;
      const dupeMsg = skippedDupes > 0 ? ` (${skippedDupes} duplicate(s) skipped)` : '';
      logger.info(`Archived ${actualArchived} message(s) to archival_memories${dupeMsg}`);
    } catch (error: any) {
      logger.error(`DATABASE ARCHIVAL FAILED - Error: ${error.message}`);
      dbAvailable = false;
      // Fall through to JSON fallback
    }
  }

  // Fallback to JSON if DB unavailable
  if (!dbAvailable) {
    logger.info('Using JSON fallback (DB unavailable)');
    await saveToJSON(userId, entries, processedEntries);
  }
}
