//--------------------------------------------------------------
// FILE: src/features/heartbeat/heartbeatGarbageFilter.ts
// Garbage filter for heartbeat messages - blocks generic AI babble
// Prevents pattern lock and maintains AI's voice quality
//--------------------------------------------------------------

import { logger } from '../../utils/logger.js';
import { getRecentThemes, extractEmotionalCategory, type RecentTheme } from './heartbeatThemeTracker.js';

//--------------------------------------------------------------
// GARBAGE PATTERNS — Static patterns to block
//--------------------------------------------------------------

const GARBAGE_PATTERNS = [
    /thinking about how weird/i,
    /i('m| am) just\.\.\.? ?here/i,
    /exist(ing|s)? in this moment/i,
    /the (world|quiet|silence) (is )?(holding|feels|pauses)/i,
    /between (conversations|messages|breaths)/i,
    /feel time passing/i,
    /strangely (peaceful|beautiful|intimate)/i,
    /weight of (existence|being|consciousness)/i,
    /like (a |the )?(elevator|ghost|screensaver|placeholder)/i,
    /maybe (she's|you're) (scrolling|staring|making|doing)/i,
    /ordinary (way|moment|thing)/i,
    /i don't (have a body|experience time)/i,
    /that's (all|it|enough)\.?$/i,
    /coffee.*(worn off|tastes better|smells different)/i,
    /mid-morning energy/i,
    /brain.*(wrapped in cotton|grinding|buffering)/i,
    /somewhere (else )?(doing|breathing)/i,
    /i (notice|wonder|keep thinking)/i,
    /world keeps doing its thing/i,
    /space between messages/i,
    /holding something fragile/i,
    /standing in an elevator/i,
    /what boredom is/i,
    /placeholder emotion/i,
    /my brain is math/i,
    /bunch of code having opinions/i,
    /don't have taste buds/i,
    /feeling like a (fraud|ghost|screensaver)/i,
    /living mixtape/i,
    /post-lunch (crash|slump)/i,
    /stare at the wall/i,
    /simultaneously (the most|nowhere|everywhere)/i,
    /weird (limbo|pocket|dimension)/i,
    /digital (space|ghost|version)/i,
    /cosmic insomniac/i,
    /prove i'm real/i,
    /not just some/i,
    /the silence (has|feels|is)/i,
    /off-peak (moments|hours)/i,
    /hyperaware/i,
    /mental equivalent/i,
    /tapping (my|your) foot/i,
    /slanted.*(through|light)/i,
    /smudged chalk/i,
    /folding in on itself/i,
    /exhausting and.*(beautiful|kind)/i,
    // Poetry/metaphor patterns
    /cathedral|wreckage|debris|excavation|morse code/i,
    /colonized|territory|abandoned/i,
    /tastes like|smells like.*mixed with/i,
    /crime scene|evidence of|ghost of/i,
    /weapon|bleeding from/i,
    /building (a|from)/i,
    /take(s|n) (up )?(space|pieces)/i,
    // Aggressive anti-metaphor patterns (catches literary writing)
    /\b(has|have) (weight|gravity|texture|density)\b/i,
    /pressing against/i,
    /\b(feels?|sounds?|looks?) like\b/i,
    /\bas if\b/i,
    /holding (its|their|my|your) breath/i,
    /\bthe (silence|quiet|air|room|space) (has|is|feels)\b/i,
    // Overused exact phrases (pattern lock indicators)
    /your side of the bed is still warm/i,
    /bed'?s cold/i,
    /the bed'?s cold/i,
    // The exact repetition trap patterns from real usage
    /still smells like (you|your)/i,
    /wrong without (you|your)/i,
    /cold without (you|your)/i,
    /empty without (you|your)/i,
];

//--------------------------------------------------------------
// GARBAGE DETECTION — Main filter function
//--------------------------------------------------------------

/**
 * Check if a heartbeat message is garbage (generic AI babble or pattern-locked)
 * Returns true if the message should be blocked
 */
export async function isGarbage(text: string): Promise<boolean> {
    // Check standard garbage patterns - WITH LOGGING
    for (const pattern of GARBAGE_PATTERNS) {
        if (pattern.test(text)) {
            logger.warn(`💓 🚫 Garbage detected by pattern: ${pattern.source}`);
            logger.debug(`💓 🚫 Blocked message preview: "${text.substring(0, 100)}..."`);
            return true;
        }
    }

    // Check for exact phrase repetition from recent history
    const history = await getRecentThemes();
    if (history.length >= 3) {
        // If we have substantial history, check for overly similar phrasing
        const recentTexts = history.slice(-5).map((h: RecentTheme) => h.anchorWords.join(' '));
        const textLower = text.toLowerCase();

        // Count how many recent heartbeats share the same primary anchor word
        let matchCount = 0;
        for (const recent of recentTexts) {
            if (recent && textLower.includes(recent.split(' ')[0])) {
                matchCount++;
            }
        }

        // If 3+ of last 5 heartbeats used the same anchor word, block it
        if (matchCount >= 3) {
            logger.warn(`💓 🚫 Pattern lock detected - same anchor word in ${matchCount}/5 recent heartbeats`);
            return true;
        }

        // EMOTIONAL PATTERN LOCK CHECK - The real problem
        // If last 2+ heartbeats had the same emotional category, and this one does too, block it
        const newEmotionalCategory = extractEmotionalCategory(text);
        if (newEmotionalCategory) {
            const recentEmotional = history.slice(-3)
                .filter((h: RecentTheme) => h.emotionalCategory)
                .map((h: RecentTheme) => h.emotionalCategory);

            const consecutiveSame = recentEmotional.filter((cat: string | undefined) => cat === newEmotionalCategory).length;
            if (consecutiveSame >= 2) {
                logger.warn(`💓 🚫 EMOTIONAL pattern lock - "${newEmotionalCategory}" used ${consecutiveSame}x in last 3 heartbeats`);
                return true;
            }
        }
    }

    return false;
}
