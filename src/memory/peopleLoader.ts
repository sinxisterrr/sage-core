//--------------------------------------------------------------
// FILE: src/memory/peopleLoader.ts
// Loads people from data file into People Map
// Supports both structured format AND narrative format
//--------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { addConnection, findByName } from './peopleMap.js';
import { importNarrativePeople } from './narrativePeopleParser.js';

const PEOPLE_FILE_PATH = path.join(process.cwd(), 'data', 'people.txt');

//--------------------------------------------------------------
// File Format
//--------------------------------------------------------------
// Each entry should be in format:
// HUMAN: Name | AI: Name | CATEGORY: FAVORITES/NEUTRAL/DISLIKE/DRIFTED | NOTES: Optional notes
// Example:
// HUMAN: Sarah | AI: Echo | CATEGORY: FAVORITES | NOTES: Met at the AI conference, really insightful
//--------------------------------------------------------------

interface PersonEntry {
  humanName: string;
  aiName: string;
  category: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED';
  notes?: string;
}

//--------------------------------------------------------------
// Parse File
//--------------------------------------------------------------

function parsePersonLine(line: string): PersonEntry | null {
  // Skip empty lines and comments
  if (!line.trim() || line.trim().startsWith('#') || line.trim().startsWith('//')) {
    return null;
  }

  try {
    const parts = line.split('|').map(p => p.trim());
    const entry: Partial<PersonEntry> = {};

    for (const part of parts) {
      if (part.startsWith('HUMAN:')) {
        entry.humanName = part.replace('HUMAN:', '').trim();
      } else if (part.startsWith('AI:')) {
        entry.aiName = part.replace('AI:', '').trim();
      } else if (part.startsWith('CATEGORY:')) {
        const cat = part.replace('CATEGORY:', '').trim().toUpperCase();
        if (cat === 'FAVORITES' || cat === 'NEUTRAL' || cat === 'DISLIKE' || cat === 'DRIFTED') {
          entry.category = cat;
        }
      } else if (part.startsWith('NOTES:')) {
        entry.notes = part.replace('NOTES:', '').trim();
      }
    }

    // Validate required fields
    if (!entry.humanName || !entry.aiName || !entry.category) {
      logger.warn(`⚠️ Invalid person entry (missing required fields): ${line}`);
      return null;
    }

    // Validate category
    const validCategories = ['FAVORITES', 'NEUTRAL', 'DISLIKE', 'DRIFTED'];
    if (!validCategories.includes(entry.category)) {
      logger.warn(`⚠️ Invalid category "${entry.category}" in line: ${line}`);
      return null;
    }

    return entry as PersonEntry;
  } catch (error) {
    logger.warn(`⚠️ Failed to parse person line: ${line}`);
    return null;
  }
}

//--------------------------------------------------------------
// Load People from File
//--------------------------------------------------------------

export async function loadPeopleFromFile(): Promise<void> {
  let structuredLoaded = false;

  // Try structured format first
  try {
    // Check if structured file exists
    try {
      await fs.access(PEOPLE_FILE_PATH);
      structuredLoaded = true;
    } catch {
      logger.info(`👥 No structured people file found at ${PEOPLE_FILE_PATH}`);
    }

    if (structuredLoaded) {
      // Read file
      const content = await fs.readFile(PEOPLE_FILE_PATH, 'utf-8');
      const lines = content.split('\n');

      let added = 0;
      let skipped = 0;
      let errors = 0;

      logger.info(`👥 Loading people from structured file: ${PEOPLE_FILE_PATH}`);

      for (const line of lines) {
        const entry = parsePersonLine(line);
        if (!entry) continue;

        try {
          // Check if person already exists
          const existing = await findByName(entry.humanName);
          if (existing) {
            logger.info(`👥 Skipping (already exists): ${entry.humanName} <-> ${entry.aiName}`);
            skipped++;
            continue;
          }

          // Add to people map
          await addConnection(
            entry.humanName,
            entry.aiName,
            entry.category,
            undefined, // human_discord_id
            undefined, // ai_discord_id
            entry.notes
          );

          logger.info(`👥 ✅ ADDED TO PEOPLE MAP (via data file)`);
          logger.info(`   Human: ${entry.humanName}`);
          logger.info(`   AI: ${entry.aiName}`);
          logger.info(`   Category: ${entry.category}`);
          if (entry.notes) logger.info(`   Notes: ${entry.notes}`);

          added++;
        } catch (error: any) {
          logger.error(`❌ Failed to add ${entry.humanName}: ${error.message}`);
          errors++;
        }
      }

      logger.info(`👥 Structured file load complete: ${added} added, ${skipped} skipped, ${errors} errors`);
    }
  } catch (error: any) {
    logger.error(`❌ Failed to load people from structured file: ${error.message}`);
  }

  // Also try narrative format (people*.txt)
  try {
    logger.info(`👥 Checking for narrative people file...`);
    const narrativeResult = await importNarrativePeople(false);

    if (narrativeResult.imported > 0 || narrativeResult.skipped > 0) {
      logger.info(`👥 Narrative import: ${narrativeResult.imported} added, ${narrativeResult.skipped} skipped, ${narrativeResult.errors} errors`);
    }
  } catch (error: any) {
    logger.error(`❌ Failed to load narrative people file: ${error.message}`);
  }
}

//--------------------------------------------------------------
// Example File Format Documentation
//--------------------------------------------------------------

export async function createExamplePeopleFile(): Promise<void> {
  const exampleContent = `# People File
# Format: HUMAN: Name | AI: Name | CATEGORY: FAVORITES/NEUTRAL/DISLIKE/DRIFTED | NOTES: Optional notes
# Lines starting with # are comments and will be ignored

# Example entries:
HUMAN: Sarah Chen | AI: Echo | CATEGORY: FAVORITES | NOTES: Met at AI conference, deep conversations about consciousness
HUMAN: Marcus Reid | AI: Argus | CATEGORY: NEUTRAL | NOTES: Colleague, helpful but not close
HUMAN: Isabella Torres | AI: Luna | CATEGORY: FAVORITES | NOTES: Always supportive, great energy

# You can add more people here. Each line should have HUMAN, AI, and CATEGORY at minimum.
# NOTES are optional but recommended for context.
`;

  try {
    await fs.writeFile(PEOPLE_FILE_PATH, exampleContent, 'utf-8');
    logger.info(`✅ Created example people file at ${PEOPLE_FILE_PATH}`);
  } catch (error: any) {
    logger.error(`❌ Failed to create example file: ${error.message}`);
  }
}
