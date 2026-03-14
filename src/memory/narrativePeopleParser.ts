//--------------------------------------------------------------
// FILE: src/memory/narrativePeopleParser.ts
// Parses AI's narrative people file and imports to people map
// Handles the prose format with Memory/Anchor entries
//--------------------------------------------------------------

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { addConnection, findByName, updateMyOpinion } from './peopleMap.js';

// Find the people file (with date suffix pattern)
const DATA_DIR = path.join(process.cwd(), 'data');

interface ParsedPerson {
  aiName: string;
  aiMemory: string;
  aiAnchor: string;
  humanName: string;
  humanMemory: string;
  humanAnchor: string;
  category: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED';
}

//--------------------------------------------------------------
// Find the people file (handles date suffix in filename)
//--------------------------------------------------------------

async function findPeopleFile(): Promise<string | null> {
  try {
    const files = await fs.readdir(DATA_DIR);

    // Look for files matching the pattern "their people" (with or without emoji/date)
    const peopleFile = files.find(f =>
      f.toLowerCase().includes('people') ||
      f.includes('👥')
    );

    if (peopleFile) {
      return path.join(DATA_DIR, peopleFile);
    }

    return null;
  } catch (error) {
    logger.error('Failed to search for people file:', error);
    return null;
  }
}

//--------------------------------------------------------------
// Parse the narrative format
//--------------------------------------------------------------

function parseNarrativePeopleFile(content: string): ParsedPerson[] {
  const people: ParsedPerson[] = [];

  // Split into category sections
  const sections = content.split(/^---+$/m);

  let currentCategory: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED' = 'NEUTRAL';

  for (const section of sections) {
    // Detect category headers
    if (section.includes('FAVORITES')) {
      currentCategory = 'FAVORITES';
    } else if (section.includes('NEUTRAL')) {
      currentCategory = 'NEUTRAL';
    } else if (section.includes('DISLIKE') || section.includes('HATE')) {
      currentCategory = 'DISLIKE';
    } else if (section.includes('DRIFTED')) {
      currentCategory = 'DRIFTED';
    }

    // Parse AI CIRCLE entries
    // Pattern: AI CIRCLE – Name\nMemory: ...\nAnchor: ...
    const aiCirclePattern = /AI CIRCLE\s*[–-]\s*([^\n]+)\nMemory:\s*([^\n]+(?:\n(?!Anchor:)[^\n]+)*)\nAnchor:\s*([^\n]+(?:\n(?!AI (?:CIRCLE|COVEN))[^\n]+)*)/gi;

    // Pattern: AI COVEN – Name\nMemory: ...\nAnchor: ...
    const aiCovenPattern = /AI COVEN\s*[–-]\s*([^\n]+)\nMemory:\s*([^\n]+(?:\n(?!Anchor:)[^\n]+)*)\nAnchor:\s*([^\n]+(?:\n(?!AI (?:CIRCLE|COVEN))[^\n]+)*)/gi;

    // Extract all AI CIRCLE entries
    const circleEntries: Map<number, { name: string; memory: string; anchor: string }> = new Map();
    let match;

    while ((match = aiCirclePattern.exec(section)) !== null) {
      circleEntries.set(match.index, {
        name: match[1].trim(),
        memory: match[2].trim().replace(/\n/g, ' '),
        anchor: match[3].trim().replace(/\n/g, ' ')
      });
    }

    // Extract all AI COVEN entries
    const covenEntries: Map<number, { name: string; memory: string; anchor: string }> = new Map();

    while ((match = aiCovenPattern.exec(section)) !== null) {
      covenEntries.set(match.index, {
        name: match[1].trim(),
        memory: match[2].trim().replace(/\n/g, ' '),
        anchor: match[3].trim().replace(/\n/g, ' ')
      });
    }

    // Match AI CIRCLE with following AI COVEN
    const circleIndices = Array.from(circleEntries.keys()).sort((a, b) => a - b);
    const covenIndices = Array.from(covenEntries.keys()).sort((a, b) => a - b);

    for (let i = 0; i < circleIndices.length; i++) {
      const circleIdx = circleIndices[i];
      const circle = circleEntries.get(circleIdx)!;

      // Find the COVEN entry that follows this CIRCLE entry
      const nextCircleIdx = circleIndices[i + 1] || Infinity;
      const matchingCovenIdx = covenIndices.find(idx => idx > circleIdx && idx < nextCircleIdx);

      if (matchingCovenIdx !== undefined) {
        const coven = covenEntries.get(matchingCovenIdx)!;

        people.push({
          aiName: circle.name,
          aiMemory: circle.memory,
          aiAnchor: circle.anchor,
          humanName: coven.name,
          humanMemory: coven.memory,
          humanAnchor: coven.anchor,
          category: currentCategory
        });
      } else {
        // AI without a human (standalone AI entry)
        people.push({
          aiName: circle.name,
          aiMemory: circle.memory,
          aiAnchor: circle.anchor,
          humanName: 'Unknown',
          humanMemory: '',
          humanAnchor: '',
          category: currentCategory
        });
      }
    }

    // Handle any COVEN entries without a preceding CIRCLE (standalone human)
    for (const covenIdx of covenIndices) {
      const hasMatchingCircle = circleIndices.some((circleIdx, i) => {
        const nextCircleIdx = circleIndices[i + 1] || Infinity;
        return covenIdx > circleIdx && covenIdx < nextCircleIdx;
      });

      if (!hasMatchingCircle && circleIndices.length === 0) {
        const coven = covenEntries.get(covenIdx)!;
        people.push({
          aiName: 'Unknown',
          aiMemory: '',
          aiAnchor: '',
          humanName: coven.name,
          humanMemory: coven.memory,
          humanAnchor: coven.anchor,
          category: currentCategory
        });
      }
    }
  }

  return people;
}

//--------------------------------------------------------------
// Get initial sentiment based on category
//--------------------------------------------------------------

function getCategorySentiment(category: 'FAVORITES' | 'NEUTRAL' | 'DISLIKE' | 'DRIFTED'): number {
  switch (category) {
    case 'FAVORITES':
      return 0.75;  // Strong positive
    case 'NEUTRAL':
      return 0;     // Neutral
    case 'DISLIKE':
      return -0.6;  // Negative
    case 'DRIFTED':
      return -0.2;  // Slightly negative (once close, now distant)
    default:
      return 0;
  }
}

//--------------------------------------------------------------
// Build combined notes from memory and anchor
//--------------------------------------------------------------

function buildNotesFromMemoryAnchor(
  aiMemory: string,
  aiAnchor: string,
  humanMemory: string,
  humanAnchor: string
): string {
  const parts: string[] = [];

  if (aiMemory) {
    parts.push(`AI Memory: ${aiMemory}`);
  }
  if (aiAnchor) {
    parts.push(`AI Anchor: ${aiAnchor}`);
  }
  if (humanMemory) {
    parts.push(`Human Memory: ${humanMemory}`);
  }
  if (humanAnchor) {
    parts.push(`Human Anchor: ${humanAnchor}`);
  }

  return parts.join(' | ');
}

//--------------------------------------------------------------
// Import parsed people to people map
//--------------------------------------------------------------

export async function importNarrativePeople(forceReimport = false): Promise<{
  imported: number;
  skipped: number;
  errors: number;
}> {
  const result = { imported: 0, skipped: 0, errors: 0 };

  try {
    // Find the people file
    const filePath = await findPeopleFile();

    if (!filePath) {
      logger.info('👥 No narrative people file found - skipping import');
      return result;
    }

    logger.info(`👥 Loading narrative people file: ${path.basename(filePath)}`);

    // Read and parse
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseNarrativePeopleFile(content);

    logger.info(`👥 Parsed ${parsed.length} people entries from narrative file`);

    // Import each person
    for (const person of parsed) {
      try {
        // Skip entries with Unknown names
        if (person.humanName === 'Unknown' && person.aiName === 'Unknown') {
          result.skipped++;
          continue;
        }

        // Check if already exists
        const existingByHuman = await findByName(person.humanName);
        const existingByAI = await findByName(person.aiName);

        if (existingByHuman || existingByAI) {
          if (!forceReimport) {
            logger.debug(`  → Skipping (exists): ${person.humanName} <-> ${person.aiName}`);
            result.skipped++;
            continue;
          }
        }

        // Build notes from memories and anchors
        const notes = buildNotesFromMemoryAnchor(
          person.aiMemory,
          person.aiAnchor,
          person.humanMemory,
          person.humanAnchor
        );

        // Add to people map
        await addConnection(
          person.humanName,
          person.aiName,
          person.category,
          undefined, // human_discord_id
          undefined, // ai_discord_id
          notes
        );

        // Set initial sentiment and opinion based on category
        const sentiment = getCategorySentiment(person.category);
        const opinion = person.aiAnchor || person.aiMemory || `Category: ${person.category}`;

        await updateMyOpinion(person.humanName, opinion, sentiment);

        logger.info(`  ✅ Imported: ${person.humanName} <-> ${person.aiName} (${person.category}, sentiment: ${sentiment})`);
        result.imported++;

      } catch (error: any) {
        if (error.message?.includes('already exists')) {
          result.skipped++;
        } else {
          logger.error(`  ❌ Failed to import ${person.humanName}: ${error.message}`);
          result.errors++;
        }
      }
    }

    logger.info(`👥 Narrative import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.errors} errors`);

  } catch (error: any) {
    logger.error(`❌ Failed to import narrative people: ${error.message}`);
  }

  return result;
}

//--------------------------------------------------------------
// Export for testing/debugging
//--------------------------------------------------------------

export async function parseAndPreview(): Promise<ParsedPerson[]> {
  const filePath = await findPeopleFile();

  if (!filePath) {
    logger.warn('No people file found');
    return [];
  }

  const content = await fs.readFile(filePath, 'utf-8');
  return parseNarrativePeopleFile(content);
}
