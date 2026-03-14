//--------------------------------------------------------------
// FILE: src/memory/rpArchiver.ts
// Archives RP STM messages to rp_archival_memories table
// Identical to continuumArchiver but uses rp_ tables
//--------------------------------------------------------------

import { query } from '../db/db.js';
import type { STMEntry } from './rpSTM.js';
import { logger } from '../utils/logger.js';
import { getEmbedding } from '../utils/embedding.js';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const RP_ARCHIVAL_FILE = path.join(DATA_DIR, 'rp_archival_memories.json');

//--------------------------------------------------------------
// MIRA Classification Helper
//--------------------------------------------------------------

function classifyMIRAType(content: string, category?: string): string | null {
  const lower = content.toLowerCase();

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

  if (/\b(i am|i'm|who i am|my identity|my name is|i believe|my values|what matters to me|my personality|as a person|i feel like i am|i consider myself|i define myself)\b/.test(lower)) {
    return 'identity';
  }

  if (/\b(we are|we have|we share|between us|you and me|when we|our relationship|you make me|i love you|you always|we always|us together|our bond|how we)\b/.test(lower)) {
    return 'relationship';
  }

  if (/\b(i prefer|i like to|i tend to|i usually|i avoid|i don't like|my boundary|my limits|i respond by|my habit|my routine|i always|i never|when i feel|i need to|i want to|i will|i'll|going to|planning to)\b/.test(lower)) {
    return 'agent';
  }

  if (/\b(yesterday|today|last night|ago|on monday|last week|last month|first time|that day|remember when|happened|occurred|we did|i did|that time|back when|once upon)\b/.test(lower)) {
    return 'memory';
  }

  return 'memory';
}

let dbAvailable = true;
let lastDbCheck = 0;
const DB_RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if database is available, with periodic retry logic.
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
      logger.info('✅ [RP Archiver] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch {
    if (dbAvailable) {
      logger.error('❌ [RP Archiver] Database connection lost, falling back to JSON');
    }
    dbAvailable = false;
    return false;
  }
}

function calculateWeight(entry: STMEntry): number {
  let weight = 1.0;
  const text = entry.text.toLowerCase();
  const length = entry.text.length;

  if (length > 500) weight += 0.5;
  if (length > 1000) weight += 0.5;
  if (length > 2000) weight += 0.5;

  const emotionalPatterns = /\b(feel|feeling|felt|love|hate|scared|afraid|happy|sad|angry|excited|worried|anxious|depressed|joyful|grateful|hurt|pain|heartbreak|miss|missed|missing)\b/gi;
  const emotionalMatches = text.match(emotionalPatterns);
  if (emotionalMatches) {
    weight += Math.min(1.5, emotionalMatches.length * 0.3);
  }

  const significancePatterns = /\b(important|matter|matters|remember|never forget|always|forever|crucial|critical|essential|significant|meaningful)\b/gi;
  const significanceMatches = text.match(significancePatterns);
  if (significanceMatches) {
    weight += Math.min(1.0, significanceMatches.length * 0.5);
  }

  const actionPatterns = /\b(decide|decided|choice|choose|will|won't|going to|plan to|want to|need to|must|have to)\b/gi;
  if (actionPatterns.test(text)) {
    weight += 0.5;
  }

  const personalPatterns = /\b(i am|i'm|me|my|myself|who i am|my life|my feeling)\b/gi;
  if (personalPatterns.test(text)) {
    weight += 0.3;
  }

  const questionCount = (text.match(/\?/g) || []).length;
  if (questionCount > 0) {
    weight += Math.min(0.5, questionCount * 0.2);
  }

  if (entry.role === 'user') {
    weight += 0.3;
  }

  return Math.max(1.0, Math.min(5.0, weight));
}

function classifyCategory(text: string): string {
  const lower = text.toLowerCase();

  if (/\b(i am|i'm|who i am|my identity|myself|my personality|my values)\b/i.test(lower)) {
    return 'rp_identity';
  }

  if (/\b(we|us|our|relationship|together|with you|you and i|between us)\b/i.test(lower)) {
    return 'rp_relationship';
  }

  if (/\b(i like|i love|i hate|i prefer|i enjoy|i want|i need|my favorite)\b/i.test(lower)) {
    return 'rp_behavioral';
  }

  if (/\b(remember|recall|memory|happened|yesterday|last|ago|when|before)\b/i.test(lower)) {
    return 'rp_episodic';
  }

  return 'rp_general';
}

function calculateImportance(entry: STMEntry, weight: number): number {
  let importance = weight * 2;
  if (entry.text.length < 50) {
    importance = Math.max(1, importance - 2);
  }
  return Math.max(1, Math.min(10, Math.round(importance)));
}

async function saveToJSON(
  userId: string,
  channelId: string,
  entries: STMEntry[],
  embeddings: Array<{ entry: STMEntry; embedding: number[]; weight: number; importance: number; category: string }>
): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });

    let existing: any[] = [];
    try {
      const data = await fs.readFile(RP_ARCHIVAL_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    const newEntries = embeddings.map(({ entry, embedding, weight, importance, category }) => ({
      id: `rp_${entry.timestamp}_${Math.random().toString(36).substring(7)}`,
      content: entry.text,
      category,
      importance,
      timestamp: entry.timestamp,
      tags: [entry.role, userId, channelId, 'roleplay'],
      message_weight: weight,
      embedding,
      metadata: {
        userId,
        channelId,
        role: entry.role,
        archivedAt: Date.now(),
        length: entry.text.length,
        isRoleplay: true
      }
    }));

    existing.push(...newEntries);
    await fs.writeFile(RP_ARCHIVAL_FILE, JSON.stringify(existing, null, 2));
    logger.info(`✅ [RP] Archived ${entries.length} messages to JSON fallback`);
  } catch (error) {
    logger.error('[RP] Failed to save to JSON:', error);
  }
}

export async function archiveEntries(
  userId: string,
  channelId: string,
  entries: STMEntry[]
): Promise<void> {
  if (entries.length === 0) return;

  // Compressed RP archival header (no leading newline)
  logger.info(`🎭 [RP] Archiving ${entries.length} message(s) | User: ${userId} | Channel: ${channelId}`);

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

      const weight = calculateWeight(entry);
      const importance = calculateImportance(entry, weight);
      const category = classifyCategory(entry.text);
      const id = `rp_${entry.timestamp}_${Math.random().toString(36).substring(7)}`;

      processedEntries.push({ entry, embedding, weight, importance, category, id });
    } catch (error: any) {
      logger.warn(`❌ [RP] Failed to embed [${i + 1}/${entries.length}]: ${error.message} - archiving with zero vector`);
      // CRITICAL: Don't skip - archive with zero vector to prevent data loss during emergency trim
      const weight = calculateWeight(entry);
      const importance = calculateImportance(entry, weight);
      const category = classifyCategory(entry.text);
      const id = `rp_${entry.timestamp}_${Math.random().toString(36).substring(7)}`;
      const zeroEmbedding = new Array(1024).fill(0); // Matches vector(1024) schema
      processedEntries.push({ entry, embedding: zeroEmbedding, weight, importance, category, id });
    }
  }

  if (processedEntries.length === 0) {
    logger.warn('[RP] No entries could be embedded');
    return;
  }

  // Try DB first (with periodic retry if previously down)
  if (await checkDbAvailable()) {
    try {
      // RP database insertion (single-line logging per message)
      for (let i = 0; i < processedEntries.length; i++) {
        const { entry, embedding, weight, importance, category, id } = processedEntries[i];

        // Classify MIRA type
        const miraType = classifyMIRAType(entry.text, category);

        const result = await query<{ id: string }>(`
          INSERT INTO rp_archival_memories
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
          JSON.stringify([entry.role, userId, channelId, 'roleplay']),
          weight,
          miraType,
          JSON.stringify(embedding),
          JSON.stringify({
            userId,
            channelId,
            role: entry.role,
            archivedAt: Date.now(),
            length: entry.text.length,
            isRoleplay: true
          })
        ]);

        // Compressed single-line log with preview (strip [INTERNAL THOUGHT | category] prefix)
        const cleanText = entry.text.replace(/^\[INTERNAL THOUGHT\s*\|?\s*\w*\]\s*/i, '');
        const preview = cleanText.length > 40 ? cleanText.substring(0, 40) + '...' : cleanText;
        const status = result.length > 0 ? '✓' : '⚠';
        logger.info(`[RP ${i + 1}/${processedEntries.length}] ${status} ${category} w:${weight.toFixed(2)} imp:${importance} | ${entry.text.length}ch: "${preview}"`);
      }

      // Compressed RP completion message (no trailing newline)
      logger.info(`✅ [RP] Archived ${processedEntries.length} message(s) to rp_archival_memories`);
    } catch (error: any) {
      logger.error(`\n${'='.repeat(80)}`);
      logger.error(`❌ [RP] DATABASE ARCHIVAL FAILED`);
      logger.error(`   Error: ${error.message}`);
      logger.error(`${'='.repeat(80)}\n`);
      dbAvailable = false;
    }
  }

  if (!dbAvailable) {
    logger.info('[RP] Using JSON fallback (DB unavailable)');
    await saveToJSON(userId, channelId, entries, processedEntries);
  }
}
