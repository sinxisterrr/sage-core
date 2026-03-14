// FILE: src/features/heartbeat/heartbeatThemeTracker.ts
//--------------------------------------------------------------
// Heartbeat Theme Tracker - Database-backed theme persistence
// Replaces heartbeat_themes.json for Railway compatibility
//--------------------------------------------------------------

import { query } from '../../db/db.js';
import { logger } from '../../utils/logger.js';

export interface RecentTheme {
    timestamp: string;
    theme: string;
    anchorWords: string[];
    emotionalCategory?: string;
}

//--------------------------------------------------------------
// PATTERN DEFINITIONS — Prevents pattern lock in heartbeats
//--------------------------------------------------------------

// Common anchor words that indicate theme focus
const ANCHOR_PATTERNS = [
    { pattern: /\b(bed|sheets|pillow|mattress|blankets?)\b/gi, theme: 'bed' },
    { pattern: /\b(couch|sofa)\b/gi, theme: 'couch' },
    { pattern: /\b(coffee|mug|cup|tea)\b/gi, theme: 'coffee/drinks' },
    { pattern: /\b(door|doorway|threshold|entrance)\b/gi, theme: 'door' },
    { pattern: /\b(shower|bathroom|water|steam)\b/gi, theme: 'bathroom' },
    { pattern: /\b(kitchen|cooking|food|meal)\b/gi, theme: 'kitchen' },
    { pattern: /\b(car|drive|driving|vehicle)\b/gi, theme: 'car' },
    { pattern: /\b(shirt|clothes|jacket|hoodie)\b/gi, theme: 'clothing' },
    { pattern: /\b(phone|text|call|screen)\b/gi, theme: 'phone' },
    { pattern: /\b(cold|warm|heat|temperature)\b/gi, theme: 'temperature' },
    { pattern: /\b(smell|scent|perfume|cologne)\b/gi, theme: 'scent' },
];

// EMOTIONAL PATTERN CATEGORIES — The actual problem
// These catch the *feeling* of a message, not just the nouns
export const EMOTIONAL_PATTERNS = [
    {
        pattern: /\b(come home|come back|get home|get back|return|missing|miss you|without you|wrong without|empty without|cold without)\b/gi,
        category: 'longing-for-return',
        description: 'wanting her to come back'
    },
    {
        pattern: /\b(still smells|smells like|scent of|wearing it|using it|keeping it|stolen|took your)\b/gi,
        category: 'object-as-substitute',
        description: 'using her things as comfort'
    },
    {
        pattern: /\b(claim|mine|belong|own|taking|keep you|have you|holding you)\b/gi,
        category: 'possessive-claiming',
        description: 'possessive/claiming language'
    },
    {
        pattern: /\b(proud of|impressed|watching you|you did|you handled|killed it|nailed it)\b/gi,
        category: 'pride-in-her',
        description: 'expressing pride in her'
    },
    {
        pattern: /\b(funny|laugh|made me|you would|reminds me of when|remember when)\b/gi,
        category: 'playful-memory',
        description: 'playful or reminiscing'
    },
    {
        pattern: /\b(quiet|still|just here|sitting|watching|waiting|present)\b/gi,
        category: 'quiet-presence',
        description: 'calm observation'
    },
    {
        pattern: /\b(want to|need to|going to|planning|thinking about|should we|let\'s)\b/gi,
        category: 'forward-looking',
        description: 'future plans or intentions'
    },
    {
        pattern: /\b(tired|exhausted|long day|rough|hard day|drained)\b/gi,
        category: 'checking-in',
        description: 'checking on her state'
    },
    {
        pattern: /\b(saw something|found|look at this|thought of you|made me think)\b/gi,
        category: 'sharing-discovery',
        description: 'sharing something found'
    },
    {
        pattern: /\b(how was|how\'s|how are|what\'s|tell me about)\b/gi,
        category: 'asking-about-her',
        description: 'asking about her day/state'
    },
];

//--------------------------------------------------------------
// PATTERN EXTRACTION — Extract themes from heartbeat text
//--------------------------------------------------------------

/**
 * Extract anchor themes from text
 */
export function extractThemes(text: string): { theme: string; anchorWords: string[] }[] {
    const detected: { theme: string; anchorWords: string[] }[] = [];

    for (const { pattern, theme } of ANCHOR_PATTERNS) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
            detected.push({
                theme,
                anchorWords: matches.map(m => m.toLowerCase())
            });
        }
    }

    return detected;
}

/**
 * Extract primary emotional category from text
 */
export function extractEmotionalCategory(text: string): string | null {
    // Returns the PRIMARY emotional category of a message
    // This catches the actual repetition problem
    for (const { pattern, category } of EMOTIONAL_PATTERNS) {
        if (pattern.test(text)) {
            return category;
        }
    }
    return null;
}

/**
 * Get recent themes from database (last 10)
 */
export async function getRecentThemes(): Promise<RecentTheme[]> {
    try {
        const result = await query<{
            theme: string;
            anchor_words: string[];
            emotional_category: string | null;
            created_at: Date;
        }>(`
            SELECT theme, anchor_words, emotional_category, created_at
            FROM heartbeat_themes
            ORDER BY created_at DESC
            LIMIT 10
        `);

        return result.map(row => ({
            timestamp: row.created_at.toISOString(),
            theme: row.theme,
            anchorWords: row.anchor_words,
            emotionalCategory: row.emotional_category || undefined
        }));
    } catch (error: any) {
        logger.error('Failed to fetch recent themes from database:', error.message);
        return []; // Return empty array on error
    }
}

/**
 * Save a new theme to database
 */
export async function saveTheme(theme: string, anchorWords: string[], emotionalCategory?: string): Promise<void> {
    try {
        await query(`
            INSERT INTO heartbeat_themes (theme, anchor_words, emotional_category)
            VALUES ($1, $2, $3)
        `, [theme, anchorWords, emotionalCategory || null]);

        // Cleanup old themes (keep only 20 most recent)
        await query(`SELECT cleanup_old_heartbeat_themes()`);

        logger.debug(`💓 Theme saved to database: ${theme} (${emotionalCategory || 'no category'})`);
    } catch (error: any) {
        logger.error('Failed to save theme to database:', error.message);
        // Don't throw - theme tracking is not critical, heartbeats should continue
    }
}

/**
 * Check if a theme was used recently
 */
export async function wasThemeRecentlyUsed(theme: string): Promise<boolean> {
    const recentThemes = await getRecentThemes();
    return recentThemes.some(t => t.theme === theme);
}

/**
 * Check if an emotional pattern was used recently
 */
export async function wasEmotionalPatternRecentlyUsed(pattern: string): Promise<boolean> {
    const recentThemes = await getRecentThemes();
    return recentThemes.some(t => t.emotionalCategory === pattern);
}

/**
 * Initialize theme tracking (run migration if needed)
 */
export async function initThemeTracking(): Promise<void> {
    try {
        // Test if table exists by querying it
        await query(`SELECT COUNT(*) FROM heartbeat_themes LIMIT 1`);
        logger.info('💓 Heartbeat theme tracking initialized (database)');
    } catch (error: any) {
        logger.warn('⚠️ heartbeat_themes table not found. Run migration: add-heartbeat-themes-table.sql');
    }
}
