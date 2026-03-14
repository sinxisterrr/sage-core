//--------------------------------------------------------------
// FILE: src/features/peopleSuggestionTracker.ts
// Background tracker that monitors name mentions and suggests adding people
//--------------------------------------------------------------

import { logger } from "../utils/logger.js";
import { query } from "../db/db.js";
import { loadPeopleMap } from "../memory/peopleMap.js";

//--------------------------------------------------------------
// Configuration
//--------------------------------------------------------------

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every 1 hour
const MENTION_THRESHOLD = 5; // Suggest after 5 mentions
const LOOKBACK_DAYS = 7; // Check last 7 days of memories

//--------------------------------------------------------------
// Tracker State
//--------------------------------------------------------------

interface NameMention {
  name: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
}

let trackedNames = new Map<string, NameMention>();
let notifiedNames = new Set<string>(); // Track who we've already notified about
let timer: NodeJS.Timeout | null = null;

//--------------------------------------------------------------
// Start/Stop Tracker
//--------------------------------------------------------------

export function startPeopleSuggestionTracker() {
  if (timer) {
    logger.warn("⚠️ People suggestion tracker already running");
    return;
  }

  logger.info("👥 Starting people suggestion tracker (checks every hour)");

  // Run immediately on start
  checkForPeopleSuggestions().catch(err => {
    logger.error("❌ People suggestion tracker initial check failed:", err);
  });

  // Then run periodically
  timer = setInterval(async () => {
    try {
      await checkForPeopleSuggestions();
    } catch (err) {
      logger.error("❌ People suggestion tracker check failed:", err);
    }
  }, CHECK_INTERVAL_MS);
}

export function stopPeopleSuggestionTracker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info("👥 People suggestion tracker stopped");
  }
}

//--------------------------------------------------------------
// Check for People to Suggest
//--------------------------------------------------------------

async function checkForPeopleSuggestions() {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);

    // Query recent memories
    const result = await query<any>(`
      SELECT content, timestamp
      FROM archival_memories
      WHERE state != 'forgotten'
        AND timestamp >= $1
      ORDER BY timestamp DESC
      LIMIT 1000
    `, [cutoffDate.getTime()]);

    if (!result || result.length === 0) {
      return;
    }

    // Extract potential names (capitalized words, excluding common words)
    // Comprehensive list to avoid false positives (verbs, pronouns, conjunctions, etc.)
    const commonWords = new Set([
      // Pronouns & basic words
      'I', 'You', 'He', 'She', 'It', 'We', 'They', 'Me', 'Him', 'Her', 'Us', 'Them',
      'My', 'Your', 'His', 'Its', 'Our', 'Their', 'Mine', 'Yours', 'Hers', 'Ours', 'Theirs',
      'The', 'A', 'An', 'This', 'That', 'These', 'Those',

      // Common verbs (sentence starters)
      'Is', 'Are', 'Was', 'Were', 'Be', 'Been', 'Being', 'Have', 'Has', 'Had', 'Having',
      'Do', 'Does', 'Did', 'Doing', 'Done', 'Will', 'Would', 'Could', 'Should', 'Can', 'May', 'Might', 'Must',
      'Get', 'Gets', 'Got', 'Getting', 'Give', 'Gives', 'Gave', 'Giving', 'Given',
      'Go', 'Goes', 'Went', 'Going', 'Gone', 'Come', 'Comes', 'Came', 'Coming',
      'Let', 'Lets', 'Make', 'Makes', 'Made', 'Making', 'Take', 'Takes', 'Took', 'Taking', 'Taken',
      'See', 'Sees', 'Saw', 'Seeing', 'Seen', 'Know', 'Knows', 'Knew', 'Knowing', 'Known',
      'Think', 'Thinks', 'Thought', 'Thinking', 'Feel', 'Feels', 'Felt', 'Feeling',
      'Want', 'Wants', 'Wanted', 'Wanting', 'Need', 'Needs', 'Needed', 'Needing',
      'Like', 'Likes', 'Liked', 'Liking', 'Love', 'Loves', 'Loved', 'Loving',
      'Try', 'Tries', 'Tried', 'Trying', 'Use', 'Uses', 'Used', 'Using',
      'Say', 'Says', 'Said', 'Saying', 'Tell', 'Tells', 'Told', 'Telling',
      'Ask', 'Asks', 'Asked', 'Asking', 'Call', 'Calls', 'Called', 'Calling',
      'Keep', 'Keeps', 'Kept', 'Keeping', 'Put', 'Puts', 'Putting',
      'Mean', 'Means', 'Meant', 'Meaning', 'Seem', 'Seems', 'Seemed', 'Seeming',
      'Help', 'Helps', 'Helped', 'Helping', 'Show', 'Shows', 'Showed', 'Showing', 'Shown',
      'Find', 'Finds', 'Found', 'Finding', 'Turn', 'Turns', 'Turned', 'Turning',
      'Leave', 'Leaves', 'Left', 'Leaving', 'Move', 'Moves', 'Moved', 'Moving',
      'Live', 'Lives', 'Lived', 'Living', 'Believe', 'Believes', 'Believed', 'Believing',
      'Bring', 'Brings', 'Brought', 'Bringing', 'Happen', 'Happens', 'Happened', 'Happening',
      'Write', 'Writes', 'Wrote', 'Writing', 'Written', 'Sit', 'Sits', 'Sat', 'Sitting',
      'Stand', 'Stands', 'Stood', 'Standing', 'Run', 'Runs', 'Ran', 'Running',
      'Set', 'Sets', 'Setting', 'Become', 'Becomes', 'Became', 'Becoming',

      // Conjunctions & prepositions
      'And', 'Or', 'But', 'For', 'Nor', 'Yet', 'So', 'Because', 'Since', 'Unless', 'Until',
      'With', 'Without', 'Within', 'From', 'Into', 'Upon', 'About', 'Above', 'After', 'Before',
      'Through', 'During', 'Between', 'Among', 'Under', 'Over', 'Below', 'Across',

      // Adverbs & adjectives
      'Not', 'No', 'Never', 'Nothing', 'Nobody', 'None', 'Nowhere',
      'All', 'Any', 'Some', 'Many', 'Much', 'More', 'Most', 'Few', 'Less', 'Least',
      'Every', 'Each', 'Either', 'Neither', 'Both', 'Such', 'Same', 'Other', 'Another',
      'Just', 'Only', 'Even', 'Also', 'Too', 'Very', 'Really', 'Quite', 'Rather',
      'Well', 'Better', 'Best', 'Good', 'Bad', 'Worse', 'Worst',
      'Now', 'Then', 'Here', 'There', 'Where', 'When', 'Why', 'How',
      'Always', 'Often', 'Sometimes', 'Usually', 'Rarely', 'Seldom',
      'Today', 'Tomorrow', 'Yesterday', 'Tonight',

      // Question words & misc
      'What', 'Who', 'Which', 'Whose', 'Whom',
      'Yes', 'Yeah', 'Okay', 'Maybe', 'Please', 'Thanks', 'Sorry',

      // Bot & user names (excluded dynamically from env vars)
      ...[process.env.USER_NAME, process.env.AI_NAME].filter(Boolean) as string[],

      // Days & months
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
      'September', 'October', 'November', 'December'
    ]);

    const currentCounts = new Map<string, NameMention>();

    for (const row of result) {
      const content = row.content || '';
      const timestamp = new Date(row.timestamp);

      // Match capitalized words (potential names)
      const matches = content.match(/\b[A-Z][a-z]+\b/g);
      if (matches) {
        for (const match of matches) {
          if (!commonWords.has(match) && match.length > 2) {
            const existing = currentCounts.get(match);
            if (existing) {
              existing.count++;
              existing.lastSeen = timestamp;
            } else {
              currentCounts.set(match, {
                name: match,
                count: 1,
                firstSeen: timestamp,
                lastSeen: timestamp
              });
            }
          }
        }
      }
    }

    // Load existing people map to filter out already-tracked people
    const peopleMap = await loadPeopleMap();
    const existingNames = new Set<string>();

    for (const conn of peopleMap.connections) {
      existingNames.add(conn.human.name.toLowerCase());
      existingNames.add(conn.ai.name.toLowerCase());
      if (conn.human.covenName) existingNames.add(conn.human.covenName.toLowerCase());
      if (conn.ai.circleName) existingNames.add(conn.ai.circleName.toLowerCase());
    }

    // Find people to suggest
    const suggestions: NameMention[] = [];

    for (const [name, mention] of currentCounts.entries()) {
      const nameLower = name.toLowerCase();

      // Skip if already in people map
      if (existingNames.has(nameLower)) continue;

      // Skip if we've already notified about this person
      if (notifiedNames.has(nameLower)) continue;

      // Check if they've crossed the threshold
      if (mention.count >= MENTION_THRESHOLD) {
        suggestions.push(mention);
        notifiedNames.add(nameLower); // Mark as notified
      }
    }

    // Update tracked names
    trackedNames = currentCounts;

    // Log suggestions (these will appear in logs, not sent as messages)
    // Only log if we have reasonable number of suggestions (avoid spam from false positives)
    if (suggestions.length > 0 && suggestions.length <= 10) {
      logger.info(`👥 Found ${suggestions.length} frequently mentioned ${suggestions.length === 1 ? 'person' : 'people'}:`);
      for (const suggestion of suggestions) {
        logger.info(`   • ${suggestion.name} (${suggestion.count} mentions in last ${LOOKBACK_DAYS} days)`);
      }
      logger.info(`   💡 Use suggest_people_from_memories tool to review and add.`);
    } else if (suggestions.length > 10) {
      // Too many suggestions = likely false positives, just log count
      logger.info(`👥 Found ${suggestions.length} potential people (use suggest_people_from_memories tool to review)`);
    }

    // Return suggestions for potential future use
    return suggestions;
  } catch (error: any) {
    logger.error("❌ Error checking for people suggestions:", error.message);
    return [];
  }
}

//--------------------------------------------------------------
// Manual Trigger (for testing)
//--------------------------------------------------------------

export async function triggerPeopleSuggestionCheck(): Promise<NameMention[]> {
  logger.info("👥 Manually triggering people suggestion check...");
  return await checkForPeopleSuggestions() || [];
}

//--------------------------------------------------------------
// Get Current Tracked Names
//--------------------------------------------------------------

export function getTrackedNames(): NameMention[] {
  return Array.from(trackedNames.values())
    .sort((a, b) => b.count - a.count);
}
