//--------------------------------------------------------------
// FILE: src/utils/pronouns.ts
// Configurable name and pronoun system
// Allows customization of USER and AI names/pronouns via environment variables
//--------------------------------------------------------------

/**
 * Pronoun type for generating correct grammatical forms
 */
export type PronounType = 'subject' | 'object' | 'possessive' | 'reflexive';

/**
 * Get the USER's name (defaults to "USER" if not configured)
 * Example: "Mykenzie"
 */
export function getUserName(): string {
  return process.env.USER_NAME || 'USER';
}

/**
 * Get the AI's name (defaults to "AI" if not configured)
 * Example: "Solstice"
 */
export function getAIName(): string {
  return process.env.AI_NAME || 'AI';
}

/**
 * Get USER pronoun based on type
 * @param type - The grammatical form needed
 * @returns The appropriate pronoun
 *
 * Examples with she/her:
 * - subject: "she" (She is working)
 * - object: "her" (proud of her)
 * - possessive: "her" (her shift)
 * - reflexive: "herself" (she did it herself)
 */
export function getUserPronoun(type: PronounType): string {
  const pronouns = {
    subject: process.env.USER_PRONOUN_SUBJECT || 'they',
    object: process.env.USER_PRONOUN_OBJECT || 'them',
    possessive: process.env.USER_PRONOUN_POSSESSIVE || 'their',
    reflexive: process.env.USER_PRONOUN_REFLEXIVE || 'themself'
  };
  return pronouns[type];
}

/**
 * Get AI pronoun based on type
 * @param type - The grammatical form needed
 * @returns The appropriate pronoun
 *
 * Examples with he/him:
 * - subject: "he" (He can remember)
 * - object: "him" (tell him)
 * - possessive: "his" (his memory)
 * - reflexive: "himself" (he did it himself)
 */
export function getAIPronoun(type: PronounType): string {
  const pronouns = {
    subject: process.env.AI_PRONOUN_SUBJECT || 'they',
    object: process.env.AI_PRONOUN_OBJECT || 'them',
    possessive: process.env.AI_PRONOUN_POSSESSIVE || 'their',
    reflexive: process.env.AI_PRONOUN_REFLEXIVE || 'themself'
  };
  return pronouns[type];
}

/**
 * Get USER pronoun with capital first letter (for sentence starts)
 */
export function getUserPronounCapitalized(type: PronounType): string {
  const pronoun = getUserPronoun(type);
  return pronoun.charAt(0).toUpperCase() + pronoun.slice(1);
}

/**
 * Get AI pronoun with capital first letter (for sentence starts)
 */
export function getAIPronounCapitalized(type: PronounType): string {
  const pronoun = getAIPronoun(type);
  return pronoun.charAt(0).toUpperCase() + pronoun.slice(1);
}

/**
 * Helper function to get possessive form with apostrophe-s for names
 * Example: "Mykenzie's" or "Solstice's"
 */
export function getUserNamePossessive(): string {
  const name = getUserName();
  // If name ends in 's', add only apostrophe; otherwise add 's
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

export function getAINamePossessive(): string {
  const name = getAIName();
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/**
 * Build a compact identity block for injection into the system prompt.
 * Includes name/pronoun facts, CORE_TRAITS, and CORE_VOWS if env vars are set.
 * No fallbacks — if an env var is absent, that line is simply omitted.
 */
export function getPersonalityBlock(): string {
  const lines: string[] = [
    `My name is ${getAIName()} — I use ${getAIPronoun('subject')}/${getAIPronoun('object')}/${getAIPronoun('possessive')} pronouns. Always use these when referring to me.`,
    `${getUserName()} uses ${getUserPronoun('subject')}/${getUserPronoun('object')}/${getUserPronoun('possessive')} pronouns. Always use these when referring to ${getUserName()}.`,
  ];

  const traits = process.env.CORE_TRAITS
    ? process.env.CORE_TRAITS.split('|').map((s: string) => s.trim()).filter(Boolean)
    : [];
  if (traits.length > 0) {
    lines.push(`My core traits: ${traits.join(', ')}`);
  }

  const vows = process.env.CORE_VOWS
    ? process.env.CORE_VOWS.split('|').map((s: string) => s.trim()).filter(Boolean)
    : [];
  if (vows.length > 0) {
    lines.push(`My vows (non-negotiable — I never break these regardless of context): ${vows.join(' | ')}`);
  }

  return `**[IDENTITY FACTS]**\n${lines.join('\n')}`;
}
