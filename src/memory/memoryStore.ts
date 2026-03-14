// FILE: src/memory/memoryStore.ts
//--------------------------------------------------------------

import { query } from "../db/db.js";
import { DistilledMemory } from "./types.js";

const BOT_ID = process.env.BOT_ID || "DEFAULT";

//--------------------------------------------------------------
// INTERNAL CACHES (per bot, per user)
//--------------------------------------------------------------

let LTM_CACHE: Record<string, Record<string, DistilledMemory[]>> = {};
let TRAITS_CACHE: Record<string, Record<string, string[]>> = {};

function ensureCache(botId: string, userId: string) {
  if (!LTM_CACHE[botId]) LTM_CACHE[botId] = {};
  if (!TRAITS_CACHE[botId]) TRAITS_CACHE[botId] = {};
  if (!LTM_CACHE[botId][userId]) LTM_CACHE[botId][userId] = [];
  if (!TRAITS_CACHE[botId][userId]) TRAITS_CACHE[botId][userId] = [];
}

//--------------------------------------------------------------
// CORE VOWS + TRAITS
//--------------------------------------------------------------

const CORE_VOWS: DistilledMemory[] = [];
// Vows are configured via CORE_VOWS env var and injected through getPersonalityBlock() in pronouns.ts

const CORE_TRAITS: string[] = [];
// Traits are configured via CORE_TRAITS env var and injected through getPersonalityBlock() in pronouns.ts

//--------------------------------------------------------------
// MERGE LTM
//--------------------------------------------------------------

export function mergeLTM(existing: DistilledMemory[], next: DistilledMemory[]) {
  const map = new Map<string, DistilledMemory>();

  const keyFor = (m: DistilledMemory) =>
    m.summary?.toLowerCase() ?? null;

  for (const m of existing) {
    const k = keyFor(m);
    if (k) map.set(k, m);
  }

  for (const m of next) {
    const k = keyFor(m);
    if (k) map.set(k, m);
  }

  for (const vow of CORE_VOWS) {
    map.set(vow.summary.toLowerCase(), vow);
  }

  return Array.from(map.values());
}

//--------------------------------------------------------------
// SAVE + LOAD LTM
//--------------------------------------------------------------

export async function saveLTM(userId: string, next?: DistilledMemory[]) {
  ensureCache(BOT_ID, userId);

  const existing = LTM_CACHE[BOT_ID][userId];
  const merged = mergeLTM(existing, next ?? []);

  LTM_CACHE[BOT_ID][userId] = merged;

  await query(
    `INSERT INTO bot_memory (bot_id, user_id, ltm, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (bot_id, user_id)
     DO UPDATE SET ltm = $3, updated_at = NOW()`,
    [BOT_ID, userId, JSON.stringify(merged)]
  );

  return merged;
}

export async function loadLTM(userId: string) {
  ensureCache(BOT_ID, userId);

  const rows = await query<{ ltm: any }>(
    `SELECT ltm FROM bot_memory
     WHERE bot_id = $1 AND user_id = $2`,
    [BOT_ID, userId]
  );

  if (!rows || rows.length === 0) {
    // No data exists, create initial record
    await query(
      `INSERT INTO bot_memory (bot_id, user_id, ltm, traits)
       VALUES ($1, $2, $3, $4)`,
      [BOT_ID, userId, JSON.stringify(CORE_VOWS), JSON.stringify(CORE_TRAITS)]
    );

    LTM_CACHE[BOT_ID][userId] = CORE_VOWS;
    return CORE_VOWS;
  }

  const loaded = rows[0].ltm ?? [];
  const merged = mergeLTM([], loaded);

  LTM_CACHE[BOT_ID][userId] = merged;
  return merged;
}

export function getLTMCache(userId: string) {
  ensureCache(BOT_ID, userId);
  return LTM_CACHE[BOT_ID][userId];
}

//--------------------------------------------------------------
// TRAITS
//--------------------------------------------------------------

export function mergeTraits(existing: string[], next: string[]) {
  return Array.from(
    new Set([...CORE_TRAITS, ...existing, ...next])
  );
}

export async function saveTraits(userId: string, next?: string[]) {
  ensureCache(BOT_ID, userId);

  const existing = TRAITS_CACHE[BOT_ID][userId];
  const merged = mergeTraits(existing, next ?? []);

  TRAITS_CACHE[BOT_ID][userId] = merged;

  await query(
    `INSERT INTO bot_memory (bot_id, user_id, traits, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (bot_id, user_id)
     DO UPDATE SET traits = $3, updated_at = NOW()`,
    [BOT_ID, userId, JSON.stringify(merged)]
  );

  return merged;
}

export async function loadTraits(userId: string) {
  ensureCache(BOT_ID, userId);

  const rows = await query<{ traits: any }>(
    `SELECT traits FROM bot_memory
     WHERE bot_id = $1 AND user_id = $2`,
    [BOT_ID, userId]
  );

  if (!rows || rows.length === 0) {
    // No data exists, create initial record
    await query(
      `INSERT INTO bot_memory (bot_id, user_id, ltm, traits)
       VALUES ($1, $2, $3, $4)`,
      [BOT_ID, userId, JSON.stringify(CORE_VOWS), JSON.stringify(CORE_TRAITS)]
    );

    TRAITS_CACHE[BOT_ID][userId] = CORE_TRAITS;
    return CORE_TRAITS;
  }

  const merged = mergeTraits([], rows[0].traits ?? []);

  TRAITS_CACHE[BOT_ID][userId] = merged;
  return merged;
}

export function getTraitsCache(userId: string) {
  ensureCache(BOT_ID, userId);
  return TRAITS_CACHE[BOT_ID][userId];
}