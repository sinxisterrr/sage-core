//--------------------------------------------------------------
// FILE: src/memory/continuumDistiller.ts
// Every 12 messages, distill into persona/human blocks
//--------------------------------------------------------------

import { query } from '../db/db.js';
import type { STMEntry } from './continuumSTM.js';
import fs from 'fs/promises';
import path from 'path';

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://localhost:3000';
const DATA_DIR = path.join(process.cwd(), 'data');
const PERSONA_FILE = path.join(DATA_DIR, 'persona_blocks.json');
const HUMAN_FILE = path.join(DATA_DIR, 'human_blocks.json');

let dbAvailable = true;
let messagesSinceLastDistill = 0;
const DISTILL_INTERVAL = 12;

/**
 * Get embedding from local service
 */
async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.status}`);
  }

  const result = await response.json();
  return result.embedding;
}

/**
 * Classify MIRA type
 */
function classifyMIRA(texts: string[], role: 'user' | 'assistant'): string {
  const combined = texts.join(' ').toLowerCase();

  if (role === 'assistant') {
    // Persona classification
    if (/\b(i am|i'm|who i am|my identity|i feel)\b/i.test(combined)) return 'identity';
    if (/\b(i remember|i recall|memory|happened|was)\b/i.test(combined)) return 'memory';
    if (/\b(we|us|our|you and i|between us)\b/i.test(combined)) return 'relationship';
    if (/\b(i will|i can|i'll|going to|planning)\b/i.test(combined)) return 'agent';
  } else {
    // Human classification
    if (/\b(i am|i'm|who i am|my|me)\b/i.test(combined)) return 'identity';
    if (/\b(remember|recall|when|happened)\b/i.test(combined)) return 'memory';
    if (/\b(we|us|our|you and i)\b/i.test(combined)) return 'relationship';
  }

  return 'unknown';
}

/**
 * Calculate average weight
 */
function calculateAverageWeight(entries: STMEntry[]): number {
  // Weight based on length and emotional content
  const weights = entries.map(entry => {
    let weight = 1.0;
    const text = entry.text.toLowerCase();

    if (entry.text.length > 500) weight += 0.5;
    if (entry.text.length > 1000) weight += 0.5;

    const emotionalPatterns = /\b(feel|love|hate|afraid|happy|sad|worried|excited)\b/gi;
    const matches = text.match(emotionalPatterns);
    if (matches) weight += Math.min(1.0, matches.length * 0.3);

    return weight;
  });

  return weights.reduce((sum, w) => sum + w, 0) / weights.length;
}

/**
 * Save persona block to DB or JSON
 */
async function savePersonaBlock(block: {
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
  embedding: number[];
}): Promise<void> {
  const id = `persona_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  if (dbAvailable) {
    try {
      await query(`
        INSERT INTO persona_blocks
        (id, label, content, mira_type, average_weight, min_weight, max_weight, message_count, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        block.label,
        block.content,
        block.miraType,
        block.averageWeight,
        block.averageWeight - 0.5,
        block.averageWeight + 0.5,
        block.messageCount,
        JSON.stringify(block.embedding)
      ]);
      console.log(`✅ Saved persona block to DB: ${block.label}`);
      return;
    } catch (error) {
      console.error('❌ DB save failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  // JSON fallback
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing: any[] = [];
    try {
      const data = await fs.readFile(PERSONA_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    existing.push({ id, ...block });
    await fs.writeFile(PERSONA_FILE, JSON.stringify(existing, null, 2));
    console.log(`✅ Saved persona block to JSON: ${block.label}`);
  } catch (error) {
    console.error('Failed to save persona block:', error);
  }
}

/**
 * Save human block to DB or JSON
 */
async function saveHumanBlock(block: {
  label: string;
  content: string;
  miraType: string;
  averageWeight: number;
  messageCount: number;
  embedding: number[];
}): Promise<void> {
  const id = `human_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  if (dbAvailable) {
    try {
      await query(`
        INSERT INTO human_blocks
        (id, label, content, mira_type, average_weight, min_weight, max_weight, message_count, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        id,
        block.label,
        block.content,
        block.miraType,
        block.averageWeight,
        block.averageWeight - 0.5,
        block.averageWeight + 0.5,
        block.messageCount,
        JSON.stringify(block.embedding)
      ]);
      console.log(`✅ Saved human block to DB: ${block.label}`);
      return;
    } catch (error) {
      console.error('❌ DB save failed, falling back to JSON');
      dbAvailable = false;
    }
  }

  // JSON fallback
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    let existing: any[] = [];
    try {
      const data = await fs.readFile(HUMAN_FILE, 'utf-8');
      existing = JSON.parse(data);
    } catch {
      // File doesn't exist yet
    }

    existing.push({ id, ...block });
    await fs.writeFile(HUMAN_FILE, JSON.stringify(existing, null, 2));
    console.log(`✅ Saved human block to JSON: ${block.label}`);
  } catch (error) {
    console.error('Failed to save human block:', error);
  }
}

/**
 * Check if it's time to distill and do it
 */
export async function checkAndDistill(recentMessages: STMEntry[]): Promise<void> {
  messagesSinceLastDistill++;

  if (messagesSinceLastDistill < DISTILL_INTERVAL) {
    return;
  }

  console.log(`🔄 Distilling blocks from last ${DISTILL_INTERVAL} messages...`);
  messagesSinceLastDistill = 0;

  // Separate by role
  const assistantMessages = recentMessages.filter(m => m.role === 'assistant');
  const userMessages = recentMessages.filter(m => m.role === 'user');

  // Distill persona block (assistant messages)
  if (assistantMessages.length > 0) {
    try {
      const texts = assistantMessages.map(m => m.text);
      const combined = texts.join('\n\n');
      const miraType = classifyMIRA(texts, 'assistant');
      const averageWeight = calculateAverageWeight(assistantMessages);

      // Get embedding FIRST (always)
      const embedding = await getEmbedding(combined);

      await savePersonaBlock({
        label: `${miraType}_${Date.now()}`,
        content: combined,
        miraType,
        averageWeight,
        messageCount: assistantMessages.length,
        embedding
      });
    } catch (error: any) {
      console.error(`❌ Failed to distill persona block (${assistantMessages.length} messages):`, error.message);
      // Don't crash - just skip this distillation
    }
  }

  // Distill human block (user messages)
  if (userMessages.length > 0) {
    try {
      const texts = userMessages.map(m => m.text);
      const combined = texts.join('\n\n');
      const miraType = classifyMIRA(texts, 'user');
      const averageWeight = calculateAverageWeight(userMessages);

      // Get embedding FIRST (always)
      const embedding = await getEmbedding(combined);

      await saveHumanBlock({
        label: `${miraType}_${Date.now()}`,
        content: combined,
        miraType,
        averageWeight,
        messageCount: userMessages.length,
        embedding
      });
    } catch (error: any) {
      console.error(`❌ Failed to distill human block (${userMessages.length} messages):`, error.message);
      // Don't crash - just skip this distillation
    }
  }
}
