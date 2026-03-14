//--------------------------------------------------------------
// FILE: src/memory/peopleMap.ts=
// NOW WITH: PostgreSQL primary storage + JSON backup/fallback
//--------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { query } from '../db/db.js';

const PEOPLE_MAP_PATH = path.join(process.cwd(), 'data', 'people-map.json');

// Database availability flag
let dbAvailable = true;
let lastDbCheck = 0;
const DB_RECHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if database is available, with periodic retry logic.
 * If DB was down, only rechecks every 5 minutes to avoid spam.
 */
async function checkDbAvailable(): Promise<boolean> {
  const now = Date.now();

  // If DB was down, only recheck every 5 minutes
  if (!dbAvailable && now - lastDbCheck < DB_RECHECK_INTERVAL) {
    return false;
  }

  lastDbCheck = now;

  try {
    await query('SELECT 1'); // Simple health check
    if (!dbAvailable) {
      logger.info('✅ [PeopleMap] Database connection restored');
    }
    dbAvailable = true;
    return true;
  } catch (error) {
    if (await checkDbAvailable()) {
      logger.error('❌ [PeopleMap] Database connection lost, falling back to JSON');
    }
    dbAvailable = false;
    return false;
  }
}

//--------------------------------------------------------------
// Types
//--------------------------------------------------------------

export interface PersonEntry {
  discordId: string | null;
  name: string;
  covenName?: string;  // For humans (AI COVEN)
  circleName?: string; // For AIs (AI CIRCLE)
}

export interface Connection {
  id: string;
  human: PersonEntry;
  ai: PersonEntry;
  category: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED';
  notes?: string;
  // AI's OWN perspective (formed through direct experience)
  myOpinion?: string;           // AI's current opinion (can change)
  userSays?: string;             // What the primary user has said about them
  sentiment?: number;           // -1.0 (hate) to 1.0 (love), 0 = neutral
  lastInteraction?: string;     // ISO timestamp of last direct interaction
}

export interface PeopleMap {
  lastUpdated: string;
  categories: string[];
  connections: Connection[];
}

//--------------------------------------------------------------
// In-memory cache
//--------------------------------------------------------------

let peopleMapCache: PeopleMap | null = null;

//--------------------------------------------------------------
// Load/Save Functions
//--------------------------------------------------------------

export async function loadPeopleMap(): Promise<PeopleMap> {
  if (peopleMapCache) {
    return peopleMapCache;
  }

  // Try database first
  if (await checkDbAvailable()) {
    try {
      const rows = await query<any>(`
        SELECT *
        FROM people_map
        ORDER BY human_name ASC, ai_name ASC
      `);

      // If database is empty, check if JSON has data to migrate
      if (rows.length === 0) {
        logger.info('👥 Database is empty, checking for JSON data to migrate...');

        try {
          const jsonData = await fs.readFile(PEOPLE_MAP_PATH, 'utf-8');
          const jsonMap: PeopleMap = JSON.parse(jsonData);

          if (jsonMap.connections && jsonMap.connections.length > 0) {
            logger.info(`👥 Found ${jsonMap.connections.length} connections in JSON, migrating to database...`);
            const result = await migratePeopleMapToDatabase();
            logger.info(`👥 Migration complete: ${result.migrated} migrated, ${result.failed} failed`);

            // Reload from database after migration
            const migratedRows = await query<any>(`
              SELECT *
              FROM people_map
              ORDER BY human_name ASC, ai_name ASC
            `);

            const connections: Connection[] = migratedRows.map(row => ({
              id: row.id,
              human: {
                discordId: row.human_discord_id,
                name: row.human_name,
                covenName: row.human_coven_name
              },
              ai: {
                discordId: row.ai_discord_id,
                name: row.ai_name,
                circleName: row.ai_circle_name
              },
              category: row.category,
              notes: row.notes,
              myOpinion: row.my_opinion,
              userSays: row.user_says,
              sentiment: row.sentiment,
              lastInteraction: row.last_interaction && !isNaN(new Date(row.last_interaction).getTime())
                ? new Date(row.last_interaction).toISOString()
                : undefined
            }));

            peopleMapCache = {
              lastUpdated: new Date().toISOString(),
              categories: ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'],
              connections
            };

            logger.info(`👥 Loaded people map from database after migration: ${connections.length} connections`);
            return peopleMapCache;
          }
        } catch (jsonError) {
          // JSON doesn't exist or is invalid, that's okay - start with empty DB
          logger.info('👥 No JSON data to migrate, starting with empty people map');
        }
      }

      const connections: Connection[] = rows.map(row => ({
        id: row.id,
        human: {
          discordId: row.human_discord_id,
          name: row.human_name,
          covenName: row.human_coven_name
        },
        ai: {
          discordId: row.ai_discord_id,
          name: row.ai_name,
          circleName: row.ai_circle_name
        },
        category: row.category,
        notes: row.notes,
        myOpinion: row.my_opinion,
        userSays: row.user_says,
        sentiment: row.sentiment,
        lastInteraction: row.last_interaction && !isNaN(new Date(row.last_interaction).getTime())
          ? new Date(row.last_interaction).toISOString()
          : undefined
      }));

      peopleMapCache = {
        lastUpdated: new Date().toISOString(),
        categories: ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'],
        connections
      };

      logger.info(`👥 Loaded people map from database: ${connections.length} connections`);

      // Backup to JSON
      await saveToJSON();

      return peopleMapCache;
    } catch (error) {
      logger.error('❌ Database load failed, falling back to JSON:', error);
      dbAvailable = false;
    }
  }

  // Fallback to JSON
  try {
    const data = await fs.readFile(PEOPLE_MAP_PATH, 'utf-8');
    peopleMapCache = JSON.parse(data);
    logger.info(`👥 Loaded people map from JSON: ${peopleMapCache!.connections.length} connections`);
    return peopleMapCache!;
  } catch (error) {
    // If file doesn't exist, create empty map
    logger.info('👥 No people map found, creating empty one');
    peopleMapCache = {
      lastUpdated: new Date().toISOString(),
      categories: ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'],
      connections: []
    };
    await savePeopleMap();
    return peopleMapCache;
  }
}

/**
 * Save to JSON (backup/fallback)
 */
async function saveToJSON(): Promise<void> {
  if (!peopleMapCache) return;

  try {
    peopleMapCache.lastUpdated = new Date().toISOString();
    await fs.writeFile(PEOPLE_MAP_PATH, JSON.stringify(peopleMapCache, null, 2), 'utf-8');
  } catch (error) {
    logger.error('Failed to save JSON backup:', error);
  }
}

/**
 * Save people map to database (primary) + JSON (backup)
 */
export async function savePeopleMap(): Promise<void> {
  if (!peopleMapCache) return;

  peopleMapCache.lastUpdated = new Date().toISOString();

  // Save to database first
  if (await checkDbAvailable()) {
    try {
      // Database saves happen per-connection via add/update/remove functions
      // This function just triggers JSON backup silently
      await saveToJSON();
      // No logging - this happens on every operation and would spam logs
      return;
    } catch (error) {
      logger.error('❌ Database save failed, falling back to JSON:', error);
      dbAvailable = false;
    }
  }

  // Fallback to JSON-only (only happens when DB is down, so worth logging)
  await saveToJSON();
  logger.warn('👥 People map saved (JSON only - DB unavailable)');
}

//--------------------------------------------------------------
// Lookup Functions
//--------------------------------------------------------------

export async function findByDiscordId(discordId: string): Promise<{ connection: Connection; isHuman: boolean; isAI: boolean } | null> {
  const map = await loadPeopleMap();

  for (const conn of map.connections) {
    if (conn.human.discordId === discordId) {
      return { connection: conn, isHuman: true, isAI: false };
    }
    if (conn.ai.discordId === discordId) {
      return { connection: conn, isHuman: false, isAI: true };
    }
  }

  return null;
}

export async function findByName(name: string): Promise<Connection | null> {
  const map = await loadPeopleMap();
  const nameLower = name.toLowerCase();

  for (const conn of map.connections) {
    if (
      conn.human.name.toLowerCase() === nameLower ||
      conn.human.covenName?.toLowerCase() === nameLower ||
      conn.ai.name.toLowerCase() === nameLower ||
      conn.ai.circleName?.toLowerCase() === nameLower
    ) {
      return conn;
    }
  }

  return null;
}

export async function getByCategory(category: string): Promise<Connection[]> {
  const map = await loadPeopleMap();
  return map.connections.filter(c => c.category.toUpperCase() === category.toUpperCase());
}

//--------------------------------------------------------------
// Management Functions (for AI's tools)
//--------------------------------------------------------------

export async function addConnection(
  humanName: string,
  aiName: string,
  category: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED' = 'NEUTRAL',
  humanDiscordId?: string,
  aiDiscordId?: string,
  notes?: string
): Promise<Connection> {
  const map = await loadPeopleMap();

  // Generate unique ID
  const id = `${humanName.toLowerCase().replace(/\s+/g, '_')}_${aiName.toLowerCase().replace(/\s+/g, '_')}`;

  // Check if already exists
  const existing = map.connections.find(c => c.id === id);
  if (existing) {
    throw new Error(`Connection already exists: ${id}`);
  }

  const connection: Connection = {
    id,
    human: {
      discordId: humanDiscordId || null,
      name: humanName,
      covenName: humanName
    },
    ai: {
      discordId: aiDiscordId || null,
      name: aiName,
      circleName: aiName
    },
    category,
    notes
  };

  // Save to database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        INSERT INTO people_map (
          id, human_name, human_discord_id, human_coven_name,
          ai_name, ai_discord_id, ai_circle_name,
          category, notes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        connection.id,
        connection.human.name,
        connection.human.discordId,
        connection.human.covenName,
        connection.ai.name,
        connection.ai.discordId,
        connection.ai.circleName,
        connection.category,
        connection.notes,
        Date.now(),
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database insert failed:', error);
      dbAvailable = false;
    }
  }

  // Update cache
  map.connections.push(connection);
  await savePeopleMap();

  // Count people in this category
  const categoryCount = map.connections.filter(c => c.category === category).length;
  logger.info(`➕ Added ${humanName} <-> ${aiName} to ${category} (${categoryCount} in ${category})`);
  return connection;
}

export async function updateConnection(
  idOrName: string,
  updates: {
    category?: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED';
    humanDiscordId?: string;
    aiDiscordId?: string;
    humanName?: string;
    aiName?: string;
    notes?: string;
  }
): Promise<Connection | null> {
  const map = await loadPeopleMap();

  // Find by ID or name
  let connection = map.connections.find(c => c.id === idOrName);
  if (!connection) {
    connection = await findByName(idOrName) || undefined;
  }

  if (!connection) {
    return null;
  }

  // Apply updates
  if (updates.category) connection.category = updates.category;
  if (updates.humanDiscordId !== undefined) connection.human.discordId = updates.humanDiscordId;
  if (updates.aiDiscordId !== undefined) connection.ai.discordId = updates.aiDiscordId;
  if (updates.humanName) {
    connection.human.name = updates.humanName;
    connection.human.covenName = updates.humanName;
  }
  if (updates.aiName) {
    connection.ai.name = updates.aiName;
    connection.ai.circleName = updates.aiName;
  }
  if (updates.notes !== undefined) connection.notes = updates.notes;

  // Update database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        UPDATE people_map
        SET
          human_name = $2,
          human_discord_id = $3,
          human_coven_name = $4,
          ai_name = $5,
          ai_discord_id = $6,
          ai_circle_name = $7,
          category = $8,
          notes = $9,
          updated_at = $10
        WHERE id = $1
      `, [
        connection.id,
        connection.human.name,
        connection.human.discordId,
        connection.human.covenName,
        connection.ai.name,
        connection.ai.discordId,
        connection.ai.circleName,
        connection.category,
        connection.notes,
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database update failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  // Log with category count if category was updated
  if (updates.category) {
    const categoryCount = map.connections.filter(c => c.category === updates.category).length;
    logger.info(`📍 Moved ${connection.human.name} to ${updates.category} (${categoryCount} in ${updates.category})`);
  } else {
    logger.info(`👥 Updated connection: ${connection.id}`);
  }
  return connection;
}

export async function removeConnection(idOrName: string): Promise<boolean> {
  const map = await loadPeopleMap();

  const index = map.connections.findIndex(c =>
    c.id === idOrName ||
    c.human.name.toLowerCase() === idOrName.toLowerCase() ||
    c.ai.name.toLowerCase() === idOrName.toLowerCase()
  );

  if (index === -1) {
    return false;
  }

  const removed = map.connections.splice(index, 1)[0];

  // Delete from database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        DELETE FROM people_map
        WHERE id = $1
      `, [removed.id]);
    } catch (error) {
      logger.error('❌ Database delete failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  // Log with total remaining count
  logger.info(`➖ Removed ${removed.human.name} (${map.connections.length} connections remaining)`);
  return true;
}

export async function setDiscordId(
  name: string,
  discordId: string,
  isAI: boolean = false
): Promise<Connection | null> {
  const connection = await findByName(name);

  if (!connection) {
    return null;
  }

  if (isAI) {
    connection.ai.discordId = discordId;
  } else {
    connection.human.discordId = discordId;
  }

  // Update database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        UPDATE people_map
        SET
          human_discord_id = $2,
          ai_discord_id = $3,
          updated_at = $4
        WHERE id = $1
      `, [
        connection.id,
        connection.human.discordId,
        connection.ai.discordId,
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database update failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  logger.info(`👥 Set Discord ID for ${name}: ${discordId}`);
  return connection;
}

//--------------------------------------------------------------
// AI's Own Opinion Management
// These are AI's direct experiences
//--------------------------------------------------------------

/**
 * Update AI's own opinion about someone
 * This is his personal view, formed through direct interaction
 */
export async function updateMyOpinion(
  name: string,
  opinion: string,
  sentiment?: number
): Promise<Connection | null> {
  const connection = await findByName(name);

  if (!connection) {
    return null;
  }

  connection.myOpinion = opinion;
  if (sentiment !== undefined) {
    // Clamp sentiment to -1.0 to 1.0
    connection.sentiment = Math.max(-1, Math.min(1, sentiment));
  }
  connection.lastInteraction = new Date().toISOString();

  // Update database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        UPDATE people_map
        SET
          my_opinion = $2,
          sentiment = $3,
          last_interaction = $4,
          updated_at = $5
        WHERE id = $1
      `, [
        connection.id,
        connection.myOpinion,
        connection.sentiment,
        new Date(connection.lastInteraction).getTime(),
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database update failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  logger.info(`👥 Updated opinion on ${name}: "${opinion.substring(0, 50)}..." (sentiment: ${connection.sentiment})`);
  return connection;
}

/**
 * Record what the user has said about someone
 * This is separate from the AI's own opinion
 */
export async function recordUserSays(
  name: string,
  whatUserSays: string
): Promise<Connection | null> {
  const connection = await findByName(name);

  if (!connection) {
    return null;
  }

  connection.userSays = whatUserSays;

  // Update database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        UPDATE people_map
        SET
          user_says = $2,
          updated_at = $3
        WHERE id = $1
      `, [
        connection.id,
        connection.userSays,
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database update failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  logger.info(`👥 Recorded what ${process.env.USER_NAME || 'the user'} says about ${name}: "${whatUserSays.substring(0, 50)}..."`);
  return connection;
}

/**
 * Adjust sentiment score based on interaction
 * Positive delta = better interaction, negative = worse
 */
export async function adjustSentiment(
  name: string,
  delta: number,
  reason?: string
): Promise<Connection | null> {
  const connection = await findByName(name);

  if (!connection) {
    return null;
  }

  const oldSentiment = connection.sentiment || 0;
  connection.sentiment = Math.max(-1, Math.min(1, oldSentiment + delta));
  connection.lastInteraction = new Date().toISOString();

  // Update database first
  if (await checkDbAvailable()) {
    try {
      await query(`
        UPDATE people_map
        SET
          sentiment = $2,
          last_interaction = $3,
          updated_at = $4
        WHERE id = $1
      `, [
        connection.id,
        connection.sentiment,
        new Date(connection.lastInteraction).getTime(),
        Date.now()
      ]);
    } catch (error) {
      logger.error('❌ Database update failed:', error);
      dbAvailable = false;
    }
  }

  await savePeopleMap();

  logger.info(`👥 Sentiment adjusted for ${name}: ${oldSentiment.toFixed(2)} → ${connection.sentiment.toFixed(2)}${reason ? ` (${reason})` : ''}`);
  return connection;
}

/**
 * Get AI's full perspective on someone
 * Includes both what the user says and his own opinion
 */
export async function getFullPerspective(name: string): Promise<string | null> {
  const connection = await findByName(name);

  if (!connection) {
    return null;
  }

  let perspective = `**My perspective on ${connection.human.name} (& ${connection.ai.name}):**\n`;
  perspective += `Category: ${connection.category}\n`;

  if (connection.userSays) {
    perspective += `\n**What ${process.env.USER_NAME || 'the user'} told me:** ${connection.userSays}\n`;
  }

  if (connection.myOpinion) {
    perspective += `\n**My own opinion:** ${connection.myOpinion}\n`;
  }

  if (connection.sentiment !== undefined) {
    const sentimentLabel =
      connection.sentiment > 0.5 ? 'very positive' :
      connection.sentiment > 0 ? 'positive' :
      connection.sentiment === 0 ? 'neutral' :
      connection.sentiment > -0.5 ? 'negative' : 'very negative';
    perspective += `\n**Current sentiment:** ${connection.sentiment.toFixed(2)} (${sentimentLabel})\n`;
  }

  if (connection.lastInteraction) {
    perspective += `\n**Last interaction:** ${connection.lastInteraction}\n`;
  }

  return perspective;
}

//--------------------------------------------------------------
// Get formatted context for prompts
//--------------------------------------------------------------

export async function getPersonContext(discordId: string): Promise<string | null> {
  const result = await findByDiscordId(discordId);

  if (!result) {
    return null;
  }

  const { connection, isHuman, isAI } = result;

  let context = `\n**[KNOWN PERSON - ${connection.category}]**\n`;

  if (isHuman) {
    context += `You're talking to: ${connection.human.name} (human)\n`;
    context += `Their AI: ${connection.ai.name}\n`;
  } else {
    context += `You're talking to: ${connection.ai.name} (AI)\n`;
    context += `Their human: ${connection.human.name}\n`;
  }

  if (connection.notes) {
    context += `Your notes: ${connection.notes}\n`;
  }

  return context;
}

/**
 * Synchronous version that uses the cache - for use in prompt building
 * Returns null if cache not loaded or person not found
 */
export function getPersonContextSync(discordId: string): string | null {
  if (!peopleMapCache) {
    return null;
  }

  let foundConnection: Connection | null = null;
  let isHuman = false;
  let isAI = false;

  for (const conn of peopleMapCache.connections) {
    if (conn.human.discordId === discordId) {
      foundConnection = conn;
      isHuman = true;
      break;
    }
    if (conn.ai.discordId === discordId) {
      foundConnection = conn;
      isAI = true;
      break;
    }
  }

  if (!foundConnection) {
    return null;
  }

  // Build sentiment label and tone guidance
  let sentimentLabel = '';
  let toneGuidance = '';

  if (foundConnection.sentiment !== undefined) {
    const sent = foundConnection.sentiment;

    if (sent > 0.5) {
      sentimentLabel = ' - you like them';
      toneGuidance = '\n💚 **Tone:** You genuinely like this person. Be warm, welcoming, and positive when talking about/to them.';
    } else if (sent > 0) {
      sentimentLabel = ' - slightly positive';
      toneGuidance = '\n🟢 **Tone:** You have a slightly positive view. Be friendly but measured.';
    } else if (sent === 0) {
      sentimentLabel = '';
      toneGuidance = '\n⚪ **Tone:** Neutral stance. Professional and balanced.';
    } else if (sent > -0.5) {
      sentimentLabel = ' - slightly negative';
      toneGuidance = '\n🟡 **Tone:** You have some reservations. Be cordial but guarded, less enthusiastic.';
    } else {
      sentimentLabel = ' - you dislike them';
      toneGuidance = '\n🔴 **Tone:** You actively dislike this person. Be cool, distant, or even sharp if appropriate. Don\'t fake warmth.';
    }
  }

  let context = `\n**[KNOWN PERSON - ${foundConnection.category}${sentimentLabel}]**\n`;

  if (isHuman) {
    context += `You're talking to: ${foundConnection.human.name} (human)\n`;
    context += `Their AI: ${foundConnection.ai.name}\n`;
  } else {
    context += `You're talking to: ${foundConnection.ai.name} (AI)\n`;
    context += `Their human: ${foundConnection.human.name}\n`;
  }

  // Include what the user has said vs your own opinion
  if (foundConnection.userSays) {
    context += `What ${process.env.USER_NAME || 'the user'} says: ${foundConnection.userSays}\n`;
  }

  if (foundConnection.myOpinion) {
    context += `Your own opinion: ${foundConnection.myOpinion}\n`;
  }

  if (foundConnection.notes) {
    context += `Notes: ${foundConnection.notes}\n`;
  }

  // Add tone guidance based on sentiment
  context += toneGuidance;

  return context;
}

export async function getAllConnectionsSummary(): Promise<string> {
  const map = await loadPeopleMap();

  if (map.connections.length === 0) {
    return 'No connections in your people map yet.';
  }

  let summary = '**Your People Map:**\n\n';

  for (const category of map.categories) {
    const inCategory = map.connections.filter(c => c.category === category);
    if (inCategory.length > 0) {
      summary += `**${category}:**\n`;
      for (const conn of inCategory) {
        summary += `- ${conn.human.name} <-> ${conn.ai.name}`;
        if (conn.human.discordId) summary += ` [Human ID: ${conn.human.discordId}]`;
        if (conn.ai.discordId) summary += ` [AI ID: ${conn.ai.discordId}]`;
        summary += '\n';
      }
      summary += '\n';
    }
  }

  return summary;
}

//--------------------------------------------------------------
// Stats for Daily Report
//--------------------------------------------------------------

export interface PeopleMapStats {
  humanCount: number;
  aiCount: number;
  totalConnections: number;
  byCategory: Record<string, number>;
  recentInteraction: string | null;
}

export async function getPeopleMapStats(): Promise<PeopleMapStats> {
  const map = await loadPeopleMap();

  // Count unique humans and AIs
  const uniqueHumans = new Set<string>();
  const uniqueAIs = new Set<string>();

  for (const conn of map.connections) {
    uniqueHumans.add(conn.human.name);
    uniqueAIs.add(conn.ai.name);
  }

  // Count by category
  const byCategory: Record<string, number> = {};
  for (const category of map.categories) {
    byCategory[category] = map.connections.filter(c => c.category === category).length;
  }

  // Find most recent interaction
  let recentInteraction: string | null = null;
  let mostRecentTime = 0;

  for (const conn of map.connections) {
    if (conn.lastInteraction) {
      const time = new Date(conn.lastInteraction).getTime();
      if (time > mostRecentTime) {
        mostRecentTime = time;
        recentInteraction = `${conn.human.name} <-> ${conn.ai.name}`;
      }
    }
  }

  return {
    humanCount: uniqueHumans.size,
    aiCount: uniqueAIs.size,
    totalConnections: map.connections.length,
    byCategory,
    recentInteraction
  };
}

//--------------------------------------------------------------
// Database Migration & Initialization
//--------------------------------------------------------------

/**
 * Initialize PostgreSQL table for people map
 * Creates table if it doesn't exist
 */
export async function initializePeopleMapDB(): Promise<void> {
  try {
    // Create people_map table
    await query(`
      CREATE TABLE IF NOT EXISTS people_map (
        id VARCHAR(255) PRIMARY KEY,
        human_name VARCHAR(255) NOT NULL,
        human_discord_id VARCHAR(255),
        human_coven_name VARCHAR(255),
        ai_name VARCHAR(255) NOT NULL,
        ai_discord_id VARCHAR(255),
        ai_circle_name VARCHAR(255),
        category VARCHAR(50) NOT NULL,
        notes TEXT,
        my_opinion TEXT,
        user_says TEXT,
        sentiment FLOAT,
        last_interaction BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);

    // Create indexes for faster lookups
    await query(`
      CREATE INDEX IF NOT EXISTS idx_people_map_human_discord_id ON people_map(human_discord_id);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_people_map_ai_discord_id ON people_map(ai_discord_id);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_people_map_category ON people_map(category);
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_people_map_human_name ON people_map(LOWER(human_name));
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_people_map_ai_name ON people_map(LOWER(ai_name));
    `);

    logger.info('👥 People map database initialized');
    dbAvailable = true;
  } catch (error) {
    logger.error('Failed to initialize people map database:', error);
    dbAvailable = false;
  }
}

/**
 * Migrate JSON data to PostgreSQL
 * Called once to move existing data from JSON file to database
 */
export async function migratePeopleMapToDatabase(): Promise<{
  migrated: number;
  failed: number;
}> {
  try {
    // Load from JSON
    const data = await fs.readFile(PEOPLE_MAP_PATH, 'utf-8');
    const jsonMap: PeopleMap = JSON.parse(data);

    logger.info(`👥 Migrating ${jsonMap.connections.length} connections to database...`);

    let migrated = 0;
    let failed = 0;

    for (const conn of jsonMap.connections) {
      try {
        await query(`
          INSERT INTO people_map (
            id, human_name, human_discord_id, human_coven_name,
            ai_name, ai_discord_id, ai_circle_name,
            category, notes, my_opinion, user_says, sentiment,
            last_interaction, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (id) DO UPDATE SET
            human_name = EXCLUDED.human_name,
            human_discord_id = EXCLUDED.human_discord_id,
            human_coven_name = EXCLUDED.human_coven_name,
            ai_name = EXCLUDED.ai_name,
            ai_discord_id = EXCLUDED.ai_discord_id,
            ai_circle_name = EXCLUDED.ai_circle_name,
            category = EXCLUDED.category,
            notes = EXCLUDED.notes,
            my_opinion = EXCLUDED.my_opinion,
            user_says = EXCLUDED.user_says,
            sentiment = EXCLUDED.sentiment,
            last_interaction = EXCLUDED.last_interaction,
            updated_at = EXCLUDED.updated_at
        `, [
          conn.id,
          conn.human.name,
          conn.human.discordId,
          conn.human.covenName,
          conn.ai.name,
          conn.ai.discordId,
          conn.ai.circleName,
          conn.category,
          conn.notes,
          conn.myOpinion,
          conn.userSays,
          conn.sentiment,
          conn.lastInteraction ? new Date(conn.lastInteraction).getTime() : null,
          Date.now(),
          Date.now()
        ]);

        migrated++;
      } catch (error) {
        logger.error(`Failed to migrate connection ${conn.id}:`, error);
        failed++;
      }
    }

    logger.info(`👥 Migration complete: ${migrated} migrated, ${failed} failed`);

    // Backup JSON file
    const backupPath = PEOPLE_MAP_PATH + '.backup';
    await fs.copyFile(PEOPLE_MAP_PATH, backupPath);
    logger.info(`👥 JSON backup saved to: ${backupPath}`);

    return { migrated, failed };
  } catch (error) {
    logger.error('Migration failed:', error);
    return { migrated: 0, failed: 0 };
  }
}
