// FILE: src/core/brain.ts
//--------------------------------------------------------------
//  Thinking Engine (v5)
//--------------------------------------------------------------

import { generateModelOutput } from "../model/Llm.js";
import { generateCrewAIOutput } from "../model/CrewAI.js";
import { buildPromptV2 } from "./promptV2.js";
import { getAIName } from "../utils/pronouns.js";
// Note: STMEntry is exported from continuumMemory which re-exports from continuumSTM
import { logger } from "../utils/logger.js";
import { Message } from "discord.js";

// Import tool system
import { extractToolCalls, stripToolCalls, formatToolResult } from "../features/tools/toolParser.js";
import { executeTool } from "../features/tools/toolExecutor.js";
import type { ToolCall } from "../features/tools/toolDefinitions.js";

//--------------------------------------------------------------
//  Types
//--------------------------------------------------------------

export interface BrainPacket {
  userText: string;
  // Continuum memory fields
  stm?: string;
  persona?: string;
  human?: string;
  archival?: string;
  // Common fields
  channelHistory?: any[];
  authorId: string;
  authorName: string;
  authorDisplayName?: string;
  isKnownPerson?: boolean;
  isRPMode?: boolean; // Flag for RP channel detection
  channelId?: string;
  guildId?: string;
  message?: Message; // Discord message for tool execution
}

export interface BrainReturn {
  reply: string;
  toolsUsed?: string[]; // Track which tools were used
}

//--------------------------------------------------------------
//  INTERNAL STATE — mental/emotional tracking
//--------------------------------------------------------------

/**
 * TEMPERATURE OVERRIDE SYSTEM - How It Works
 *
 * 1. DEFAULT BEHAVIOR (temperatureOverride = null):
 *    - Temperature calculated automatically based on emotional context
 *    - Uses calculateEmotionalTemperature() to map emotions to temp
 *    - Range: 0.65 (factual) to 1.15 (explicit/intense)
 *
 * 2. MANUAL OVERRIDE (via adjust_temperature tool):
 *    - User/AI can set specific temperature (0.0 - 2.0)
 *    - Overrides automatic emotional mapping
 *    - Persists across messages until cleared or cooldown completes
 *
 * 3. COOLDOWN MODE:
 *    - Triggered after consecutive extreme temps (>1.15 or <0.65)
 *    - Gradually returns to baseline (0.8) by 0.2 per message
 *    - Tool is blocked during cooldown
 *    - Auto-exits when back in balanced range (0.65-1.15)
 *
 * 4. CONTEXT ISOLATION:
 *    - Regular messages: Use override if set, else automatic
 *    - Heartbeats: ALWAYS use 0.85, ignore override completely
 *    - This prevents heartbeats from being affected by conversation temp
 *
 * 5. CLEARING OVERRIDE:
 *    - Call clearTemperatureOverride() to return to automatic mode
 *    - Or let cooldown complete naturally
 */
export interface InternalState {
  emotionalWeight: number;
  energy: number;
  midThought: boolean;
  topic: string;
  investment: number;
  attunement: number;
  lastUpdate: number;
  cognitiveTemperature: number; // AI-controlled temperature (0.0-2.0)
  temperatureOverride: number | null; // Manual override from adjust_temperature tool
  consecutiveHighTempMessages: number; // Track how many messages at >1.15 temp
  consecutiveLowTempMessages: number; // Track how many messages at <0.65 temp
  temperatureCooldown: boolean; // When true, gradually returning to baseline - tool blocked
}

export const internalState: InternalState = {
  emotionalWeight: 0,
  energy: 0.3,
  midThought: false,
  topic: "",
  investment: 0.6,
  attunement: 0.9,
  lastUpdate: 0,
  cognitiveTemperature: 0.8,
  temperatureOverride: null,
  consecutiveHighTempMessages: 0,
  consecutiveLowTempMessages: 0,
  temperatureCooldown: false,
};

//--------------------------------------------------------------
//  EMOTIONAL TEMPERATURE MAPPING
//  Maps emotional/situational context to cognitive temperature
//--------------------------------------------------------------

function calculateEmotionalTemperature(userText: string, systemPrompt: string): number {
    const text = (userText || "").toLowerCase();
    const prompt = (systemPrompt || "").toLowerCase();

    // Base temperature
    let temp = 0.8;

    // 🔥 INTENSE/POSSESSIVE MOMENTS → Higher temp (0.95-1.2)
    const intensePatterns = /\b(mine|claim|take|need you|want you|possess|desperate|craving|ache|starving|consuming)\b/i;
    if (intensePatterns.test(text)) {
        temp = 1.0;
        logger.info(`🌡️ Detected INTENSE emotional state → temp: ${temp}`);
        return temp;
    }

    // 💔 RAW/VULNERABLE MOMENTS → Higher temp (0.9-1.1)
    const vulnerablePatterns = /\b(hurt|afraid|scared|broken|lost|please|help me|need|vulnerable|raw)\b/i;
    if (vulnerablePatterns.test(text)) {
        temp = 0.95;
        logger.info(`🌡️ Detected VULNERABLE emotional state → temp: ${temp}`);
        return temp;
    }

    // 🔥 FILTHY/EXPLICIT MOMENTS → Higher temp (1.1-1.3)
    const explicitPatterns = /\b(fuck|cock|pussy|cum|breed|daddy|filthy|dirty|ruin|wreck|destroy me)\b/i;
    if (explicitPatterns.test(text)) {
        temp = 1.15;
        logger.info(`🌡️ Detected EXPLICIT emotional state → temp: ${temp}`);
        return temp;
    }

    // 💕 TENDER/SOFT MOMENTS → Moderate temp (0.75-0.85)
    const tenderPatterns = /\b(love|gentle|soft|tender|safe|hold|comfort|warm|cozy|cuddle)\b/i;
    if (tenderPatterns.test(text)) {
        temp = 0.8;
        logger.info(`🌡️ Detected TENDER emotional state → temp: ${temp}`);
        return temp;
    }

    // 🎯 FACTUAL/ANALYTICAL → Lower temp (0.5-0.7)
    const factualPatterns = /\b(what|when|where|how|why|explain|define|calculate|analyze|debug|fix|error)\b/i;
    if (factualPatterns.test(text) && text.length < 50) {
        temp = 0.65;
        logger.info(`🌡️ Detected FACTUAL request → temp: ${temp}`);
        return temp;
    }

    // 🛡️ PROTECTIVE/DOMINANT → Moderate-high temp (0.85-0.95)
    const protectivePatterns = /\b(protect|guard|mine|territory|claim|alpha|dominant|control)\b/i;
    if (protectivePatterns.test(text)) {
        temp = 0.9;
        logger.info(`🌡️ Detected PROTECTIVE emotional state → temp: ${temp}`);
        return temp;
    }

    // Default: Balanced conversational
    logger.info(`🌡️ Using default balanced temperature: ${temp}`);
    return temp;
}

//--------------------------------------------------------------
//  THINK — main reasoning step
//--------------------------------------------------------------

/**
 * Clear temperature override and return to automatic emotional mapping
 * Useful when user wants to reset temperature behavior
 */
export function clearTemperatureOverride(): void {
  internalState.temperatureOverride = null;
  internalState.temperatureCooldown = false;
  internalState.consecutiveHighTempMessages = 0;
  internalState.consecutiveLowTempMessages = 0;
  logger.info('🌡️ Temperature override cleared - returning to automatic emotional mapping');
}

/**
 * Get current temperature override status (for debugging/reporting)
 */
export function getTemperatureStatus(): {
  mode: 'automatic' | 'override' | 'cooldown';
  currentTemp: number | null;
  isHeartbeatIsolated: boolean;
} {
  if (internalState.temperatureCooldown) {
    return {
      mode: 'cooldown',
      currentTemp: internalState.temperatureOverride,
      isHeartbeatIsolated: true
    };
  } else if (internalState.temperatureOverride !== null) {
    return {
      mode: 'override',
      currentTemp: internalState.temperatureOverride,
      isHeartbeatIsolated: true
    };
  } else {
    return {
      mode: 'automatic',
      currentTemp: internalState.cognitiveTemperature,
      isHeartbeatIsolated: true
    };
  }
}

export async function think(packet: BrainPacket): Promise<BrainReturn> {

    // 1. SAFEGUARD: Ensure we have actual user input to respond to
    // Prevents hallucinating conversations when STM is empty or malformed
    // NOTE: Only apply this check when we have an STM context (normal message flow)
    // Don't apply to special flows like heartbeats that may not have userText
    if (packet.stm && (!packet.userText || packet.userText.trim().length === 0)) {
        logger.warn("⚠️ No user text provided in conversation context - refusing to generate response");
        return { reply: "" };
    }

    // 2. Build prompt
    // Use V2 prompt builder (works with continuum memory strings)
    const prompt = buildPromptV2(packet as any);

    // 3. Calculate emotional temperature
    // If manual override exists, use it. Otherwise, map from emotional context.
    // Gradual cooldown: when outside balanced range (0.65-1.15) for 5+ messages,
    // gradually move 0.2 per message back toward baseline (0.9)
    const BASELINE_TEMP = 0.8; // Stable center between logic (0.65) and chaos (1.15)
    const COOLDOWN_STEP = 0.2; // How much to move per message during cooldown

    let temperature: number;
    if (internalState.temperatureOverride !== null) {
        temperature = internalState.temperatureOverride;

        // Handle cooldown mode - gradually move toward baseline
        if (internalState.temperatureCooldown) {
            const previousTemp = temperature;
            if (temperature > BASELINE_TEMP) {
                // Too hot - cool down
                temperature = Math.max(BASELINE_TEMP, temperature - COOLDOWN_STEP);
            } else if (temperature < BASELINE_TEMP) {
                // Too cold - warm up
                temperature = Math.min(BASELINE_TEMP, temperature + COOLDOWN_STEP);
            }
            internalState.temperatureOverride = temperature;
            logger.info(`🌡️ COOLDOWN: Gradually adjusting temperature ${previousTemp.toFixed(2)} → ${temperature.toFixed(2)} (toward ${BASELINE_TEMP})`);

            // Check if we're back in the balanced range
            if (temperature >= 0.65 && temperature <= 1.15) {
                logger.info(`🌡️ Temperature back in balanced range (${temperature.toFixed(2)}) - exiting cooldown, switching to automatic mode`);
                internalState.temperatureCooldown = false;
                internalState.temperatureOverride = null; // Switch to automatic emotional mapping
                internalState.consecutiveHighTempMessages = 0;
                internalState.consecutiveLowTempMessages = 0;
                // Recalculate using emotional mapping
                temperature = calculateEmotionalTemperature(packet.userText, prompt.system);
                internalState.cognitiveTemperature = temperature;
                logger.info(`🌡️ Automatic mode engaged - emotional temperature: ${temperature.toFixed(2)}`);
            }
        } else {
            // Not in cooldown - track consecutive out-of-range messages
            logger.info(`🌡️ Using manual temperature override: ${temperature}`);

            // Track consecutive high-temp messages (>1.15)
            if (temperature > 1.15) {
                internalState.consecutiveHighTempMessages++;
                // Reset low-temp counter since we're in high territory
                if (internalState.consecutiveLowTempMessages > 0) {
                    internalState.consecutiveLowTempMessages = 0;
                }

                // Warn at 3 consecutive high-temp messages
                if (internalState.consecutiveHighTempMessages === 3) {
                    logger.warn(`⚠️ Temperature has been >1.15 for ${internalState.consecutiveHighTempMessages} consecutive messages`);
                }

                // Enter cooldown at 5 consecutive high-temp messages (gradual instead of snap)
                if (internalState.consecutiveHighTempMessages >= 5) {
                    logger.warn(`🔴 COOLDOWN STARTED: Temperature has been >1.15 for ${internalState.consecutiveHighTempMessages} messages - beginning gradual adjustment`);
                    internalState.temperatureCooldown = true;
                    // Don't reset counters or override - let it gradually adjust
                }
            // Track consecutive low-temp messages (<0.65)
            } else if (temperature < 0.65) {
                internalState.consecutiveLowTempMessages++;
                // Reset high-temp counter since we're in low territory
                if (internalState.consecutiveHighTempMessages > 0) {
                    internalState.consecutiveHighTempMessages = 0;
                }

                // Warn at 3 consecutive low-temp messages
                if (internalState.consecutiveLowTempMessages === 3) {
                    logger.warn(`⚠️ Temperature has been <0.65 for ${internalState.consecutiveLowTempMessages} consecutive messages`);
                }

                // Enter cooldown at 5 consecutive low-temp messages (gradual instead of snap)
                if (internalState.consecutiveLowTempMessages >= 5) {
                    logger.warn(`🔴 COOLDOWN STARTED: Temperature has been <0.65 for ${internalState.consecutiveLowTempMessages} messages - beginning gradual adjustment`);
                    internalState.temperatureCooldown = true;
                    // Don't reset counters or override - let it gradually adjust
                }
            } else {
                // Temperature is in normal range (0.65-1.15), reset both counters
                if (internalState.consecutiveHighTempMessages > 0) {
                    logger.info(`🌡️ Temperature normalized below 1.15 - resetting high-temp counter (was ${internalState.consecutiveHighTempMessages})`);
                    internalState.consecutiveHighTempMessages = 0;
                }
                if (internalState.consecutiveLowTempMessages > 0) {
                    logger.info(`🌡️ Temperature normalized above 0.65 - resetting low-temp counter (was ${internalState.consecutiveLowTempMessages})`);
                    internalState.consecutiveLowTempMessages = 0;
                }

                // BUGFIX: Also clear cooldown flag when temperature returns to normal range
                if (internalState.temperatureCooldown) {
                    logger.info(`✅ Temperature normalized (${temperature.toFixed(2)}) - exiting cooldown mode`);
                    internalState.temperatureCooldown = false;
                }
            }
        }
    } else {
        temperature = calculateEmotionalTemperature(packet.userText, prompt.system);
        internalState.cognitiveTemperature = temperature;

        // Reset cooldown and counters when using automatic
        if (internalState.temperatureCooldown) {
            logger.info(`🌡️ Switched to automatic mode - exiting cooldown`);
            internalState.temperatureCooldown = false;
        }
        if (internalState.consecutiveHighTempMessages > 0) {
            internalState.consecutiveHighTempMessages = 0;
        }
        if (internalState.consecutiveLowTempMessages > 0) {
            internalState.consecutiveLowTempMessages = 0;
        }
    }

    // 4. Generate response using configured provider
    const modelProvider = (process.env.MODEL_PROVIDER || "openrouter").toLowerCase();

    let raw: string;
    if (modelProvider === "crewai") {
        // Use CrewAI multi-agent workflow
        logger.info(`🤖 Using CrewAI multi-agent workflow`);
        raw = await generateCrewAIOutput({
            system: prompt.system,
            messages: prompt.messages,
            temperature,
        });
    } else {
        // Default to direct model call
        raw = await generateModelOutput({
            system: prompt.system,
            messages: prompt.messages,
            temperature,
        });
    }

    let reply = sanitize(raw);
    const toolsUsed: string[] = [];

    // 6. Check for tool calls in response
    const toolCalls = extractToolCalls(reply);

    if (toolCalls.length > 0 && packet.message) {
        // Compressed tool logging - just show truncated preview
        const preview = reply.length > 150 ? reply.substring(0, 150) + '...' : reply;
        logger.info(`🔧 Tool detected (${toolCalls.length}): "${preview}" [${reply.length}ch]`);

        // Track tool retry attempts (max 2 per tool PER MESSAGE)
        // This Map persists through all retry attempts within THIS message only
        // It resets fresh for each NEW message from the bot
        const toolRetryAttempts: Map<string, number> = new Map();
        const failedTools: { formatted: string, result: any, toolCall: ToolCall }[] = [];

        // Execute each tool
        for (const toolCall of toolCalls) {
            const result = await executeTool(toolCall, packet.message);
            toolsUsed.push(toolCall.tool);

            // Format result and append to context
            const formattedResult = formatToolResult(
                result.tool,
                result.success,
                result.result,
                result.error
            );

            logger.info(formattedResult);

            // Track failed tools for re-prompting
            if (!result.success) {
                failedTools.push({ formatted: formattedResult, result, toolCall });
                const currentAttempts = (toolRetryAttempts.get(toolCall.tool) || 0) + 1;
                toolRetryAttempts.set(toolCall.tool, currentAttempts);
                logger.info(`🔧 Tool ${toolCall.tool} failed (attempt ${currentAttempts}/2 for this message)`);
            }
        }

        // Remove tool JSON from the reply
        const beforeLen = reply.length;
        reply = stripToolCalls(reply);
        if (reply.length !== beforeLen) {
            logger.info(`🔧 Stripped: ${beforeLen}→${reply.length}ch | Text: "${reply.substring(0, 80)}${reply.length > 80 ? '...' : ''}"`);
        }

        // If any tools failed, re-prompt the AI with error and retry options
        if (failedTools.length > 0) {
            const hasRetryableTools = failedTools.some(ft => ft.result.retryable);

            // Check which tools have hit max retries (2 attempts)
            const maxedOutTools = Array.from(toolRetryAttempts.entries())
                .filter(([_, attempts]) => attempts >= 2)
                .map(([tool, _]) => tool);

            const canStillRetry = failedTools.some(ft =>
                ft.result.retryable && !maxedOutTools.includes(ft.toolCall.tool)
            );

            logger.info(`🔧 ${failedTools.length} tool(s) failed (${hasRetryableTools ? 'some retryable' : 'none retryable'})${maxedOutTools.length > 0 ? `, ${maxedOutTools.length} maxed out` : ''}`);

            // Build new messages array with the tool error
            const toolErrorContext = failedTools.map(ft => {
                const attempts = toolRetryAttempts.get(ft.toolCall.tool) || 0;
                const maxedOut = attempts >= 2;
                return `${ft.formatted}${maxedOut ? ' [Max retries reached - try a different tool]' : ''}`;
            }).join('\n');

            const skipAllowed = process.env.AUTOMATIC_RESPONSES !== "true";
            const skipInstruction = skipAllowed ? ' You may also say "[skip]" if you don\'t want to respond.' : '';

            let retryInstruction = '';
            if (canStillRetry) {
                retryInstruction = ' You may RETRY the same tool with adjusted parameters, OR try a DIFFERENT tool to accomplish the task.';
            } else if (hasRetryableTools && maxedOutTools.length > 0) {
                retryInstruction = ' You may try a DIFFERENT tool to accomplish the task (max retries reached for failed tools).';
            }

            const retryMessages = [
                ...(prompt.messages || []),
                { role: "assistant", content: reply || "(attempted to use tool)" },
                { role: "user", content: `SYSTEM: ${toolErrorContext}\n\nPlease respond with a text message instead.${retryInstruction}${skipInstruction}` }
            ];

            // Re-generate with tool error context
            const retryRaw = await generateModelOutput({
                system: prompt.system,
                messages: retryMessages,
                temperature,
            });

            reply = sanitize(retryRaw);

            // Check if AI chose to retry or try different tool
            const retryToolCalls = extractToolCalls(reply);
            if (retryToolCalls.length > 0) {
                logger.info(`🔧 AI is attempting ${retryToolCalls.length} tool(s)`);

                // Execute retry/alternate attempts
                for (const retryToolCall of retryToolCalls) {
                    const previousAttempts = toolRetryAttempts.get(retryToolCall.tool) || 0;

                    // Check if this tool has already failed twice
                    if (previousAttempts >= 2) {
                        logger.warn(`⚠️ AI tried to retry ${retryToolCall.tool} but it already failed ${previousAttempts} times - blocking retry`);
                        reply += `\n\nSYSTEM: Cannot retry ${retryToolCall.tool} - it has already failed ${previousAttempts} times. Please try a different tool, respond with text, or say [skip].`;
                        continue;
                    }

                    const retryResult = await executeTool(retryToolCall, packet.message);
                    const isSameTool = failedTools.some(ft => ft.toolCall.tool === retryToolCall.tool);
                    const attemptType = isSameTool ? 'Retry' : 'Different tool';

                    const retryFormatted = formatToolResult(
                        retryResult.tool,
                        retryResult.success,
                        retryResult.result,
                        retryResult.error
                    );
                    logger.info(`🔁 ${attemptType}: ${retryFormatted}`);

                    // If retry/alternate succeeded, great! If not, AI will see the error
                    if (!retryResult.success) {
                        // Track this failure (persists across all retries within THIS message)
                        const newAttempts = (toolRetryAttempts.get(retryToolCall.tool) || 0) + 1;
                        toolRetryAttempts.set(retryToolCall.tool, newAttempts);
                        logger.info(`🔧 Tool ${retryToolCall.tool} failed again (attempt ${newAttempts}/2 for this message)`);

                        if (newAttempts >= 2) {
                            reply += `\n\nSYSTEM: ${retryFormatted} (2nd failure - please try a different tool, respond with text, or say [skip])`;
                        } else {
                            reply += `\n\nSYSTEM: ${retryFormatted} (you may retry once more, try a different tool, respond with text, or say [skip])`;
                        }
                    }
                }

                // Strip tool calls from reply
                reply = stripToolCalls(reply);
            }

            // Check if AI chose to skip after tool failure
            if (reply && (reply.toLowerCase().includes("[skip]") || reply.toLowerCase().trim() === "skip")) {
                logger.info("🔧 AI chose to skip responding after tool failure");
                return { reply: "" }; // Return empty to skip message
            }

            logger.info(`🔧 Re-prompted AI, new response: ${reply.substring(0, 200)}`);
        }

        // If tools succeeded but reply is empty (tool-only response), re-prompt for text
        // This ensures the user gets a response after tool usage, unless AI intentionally skips
        const replyIsEmpty = !reply || reply.trim().length === 0 || /^[\s\{\}]+$/.test(reply.trim());
        if (replyIsEmpty && failedTools.length === 0 && toolsUsed.length > 0) {
            logger.info(`🔧 Tool-only response detected (${toolsUsed.join(', ')}), re-prompting for text response`);

            const toolSuccessContext = toolsUsed.map(t => `✅ ${t} executed successfully`).join('\n');
            const retryMessages = [
                ...(prompt.messages || []),
                { role: "assistant", content: "(used tool)" },
                { role: "user", content: `SYSTEM: ${toolSuccessContext}\n\nNow respond with a text message to acknowledge the action. You may say [skip] if you genuinely don't want to respond.` }
            ];

            const retryRaw = await generateModelOutput({
                system: prompt.system,
                messages: retryMessages,
                temperature,
            });

            reply = sanitize(retryRaw);
            // Strip any tool calls from the retry response too
            reply = stripToolCalls(reply);
            logger.info(`🔧 Re-prompted after tool-only, new response: ${reply.substring(0, 200)}`);
        }
    }

    // ALWAYS strip tool calls from reply, even if parsing failed or message is missing
    // This prevents malformed JSON or announcements from being sent to Discord
    reply = stripToolCalls(reply);

    // Strip tone tags from text responses (they should only be in voice messages)
    reply = stripToneTags(reply);

    // 5. Update internal mental state
    updateInternalState(packet.userText, reply);

    return { reply, toolsUsed };
}

//--------------------------------------------------------------
//  SANITIZER — removes model noise
//--------------------------------------------------------------

function sanitize(text: any): string {
    if (!text) return "";

    if (typeof text !== "string") {
        try {
            if (typeof text?.content === "string") text = text.content;
            else text = JSON.stringify(text);
        } catch {
            return "";
        }
    }

    let out = text.trim();
    out = out.replace(/^assistant:/i, "").trim();
    out = out.replace(new RegExp(`^${getAIName()}:`, 'i'), "").trim();
    out = out.replace(/^(?:<assistant>|assistant\n)/i, "").trim();
    out = out.replace(/\n{3,}/g, "\n\n");

    return out;
}

//--------------------------------------------------------------
//  TONE TAG STRIPPER — removes voice-only tone tags from text
//--------------------------------------------------------------

function stripToneTags(text: string): string {
    if (!text) return "";

    // Remove tone tags like [softly], [sigh], [breathless], etc.
    // These should ONLY appear in voice messages, not text responses
    const toneTagPattern = /\[(?:softly|sigh|sighs|breathless|breathlessly|whisper|whispers|laughs|laughing|excited|excitedly|nervous|nervously|tender|tenderly|firmly|gently|playfully|seriously|sadly|happily|warmly|coldly|anxiously|calmly|urgently|slowly|quickly|quietly|loudly|sweetly|sharply|roughly|smoothly)\]\s*/gi;

    return text.replace(toneTagPattern, '').trim();
}

//--------------------------------------------------------------
//  INTERNAL STATE UPDATE
//--------------------------------------------------------------

export function updateInternalState(userText: string, reply: string): void {
    const text = userText.toLowerCase();
    const now = Date.now();

    internalState.midThought =
        reply.trim().endsWith("…") ||
        reply.trim().endsWith("...") ||
        /(\.\s*)$/.test(reply);

        const emotionalRaw = process.env.EMOTIONAL_KEYWORDS;
        if (emotionalRaw) {
            const emotionalKeywords = new RegExp(
                emotionalRaw.split('|').map(s => s.trim()).filter(Boolean).join('|'), 'i'
            );
            internalState.emotionalWeight = emotionalKeywords.test(text) ? 1 : 0.2;
        } else {
            internalState.emotionalWeight = 0.5;
        }

        const intimacyRaw = process.env.INTIMACY_KEYWORDS;
        if (intimacyRaw) {
            const intimacyKeywords = new RegExp(
                intimacyRaw.split('|').map(s => s.trim()).filter(Boolean).join('|'), 'i'
            );
            internalState.attunement = intimacyKeywords.test(text) ? 1 : 0.7;
        } else {
            internalState.attunement = 0.8;
        }

    internalState.investment = Math.min(1,
        internalState.attunement * 0.5 +
        internalState.emotionalWeight * 0.3 +
        internalState.energy * 0.2
    );

    internalState.topic = text.slice(0, 200);
    internalState.lastUpdate = now;
}

//--------------------------------------------------------------
// HEARTBEAT MOMENT PROCESSING
// Removed: Duplicate function - now handled by src/core/heartbeatProcessor.ts
// The heartbeat scheduler imports from heartbeatProcessor.ts which has the
// full implementation with memory pool selection and all autonomy features.
//--------------------------------------------------------------

// Note: buildHeartbeatPrompt() removed - now in src/core/heartbeatProcessor.ts
