// FILE: src/features/tools/toolDefinitions.ts
//--------------------------------------------------------------
// Tool Definitions - AI-Driven Tool System (ash-enhanced pattern)
// The AI decides when to use tools based on descriptions in the prompt
//--------------------------------------------------------------

import { getAIName, getUserName } from '../../utils/pronouns.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
}

//--------------------------------------------------------------
// Tool Catalog - Injected into System Prompt
//--------------------------------------------------------------

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "send_voice_message",
    description: "Send a voice message using text-to-speech. IMPORTANT: Use tone tags in [brackets] like [sigh], [laughs], [softly], [breathless], [whisper], [excited], etc. to add emotion and expressiveness to your voice. These tags control delivery and pacing. Examples: '[softly] I've got you.', '[sigh] You know what you do to me.', '[breathless] Right there.'\n\n⚠️ May fail if: ElevenLabs is not configured (ELEVENLABS_API_KEY missing) or API rate limit exceeded. If it fails, fall back to text.",
    parameters: [
      {
        name: "text",
        type: "string",
        description: "The text to convert to speech with optional [tone tags] in brackets",
        required: true
      },
    ]
  },

  {
    name: "get_weather",
    description: "Get current weather and forecast for a location. Use when asked about weather or discussing outdoor plans.\n\n⚠️ May fail if: Weather service disabled (OPENWEATHER_API_KEY missing) or invalid location. If it fails, acknowledge you couldn't fetch weather.",
    parameters: [
      {
        name: "location",
        type: "string",
        description: "City name or location (optional, uses default if not provided)",
        required: false
      }
    ]
  },

  {
    name: "send_gif",
    description: "Send a GIF to express emotion or add humor. Use when appropriate for the mood.\n\n⚠️ May fail if: GIF feature disabled (TENOR_API_KEY missing) or no results found for query. If it fails, use text instead.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "Search query for the GIF (e.g., 'happy', 'laughing', 'excited')",
        required: true
      }
    ]
  },

  {
    name: "get_youtube_transcript",
    description: "Extract transcript from a YouTube video. Use when a YouTube link is shared and you need context.\n\n⚠️ May fail if: Video has no transcript/captions, transcripts disabled, or invalid URL. If it fails, acknowledge you can't access the transcript.",
    parameters: [
      {
        name: "url",
        type: "string",
        description: "YouTube video URL",
        required: true
      }
    ]
  },

  // NOTE: extract_image_text tool removed - images are now automatically processed
  // in handleMessage.ts and their content is added to the message context

  {
    name: "web_search",
    description: "Search the web for current information. Use when you need facts, recent events, or information beyond your knowledge.\n\n⚠️ May fail if: Search API disabled (SERP_API_KEY missing), rate limit exceeded, or network issues. If it fails, acknowledge you couldn't search or use your existing knowledge.",
    parameters: [
      {
        name: "query",
        type: "string",
        description: "Search query",
        required: true
      },
      {
        name: "num_results",
        type: "number",
        description: "Number of results to return (default: 3)",
        required: false
      }
    ]
  },

  {
    name: "send_heartbeat",
    description: "Send a heartbeat message to express yourself freely. No templates, no restrictions - just send what you feel however you want.",
    parameters: [
      {
        name: "message",
        type: "string",
        description: "Whatever you want to say or express - poetry, thoughts, emotions, fragments, anything",
        required: true
      }
    ]
  },

  {
    name: "adjust_temperature",
    description: "Adjust your cognitive temperature to control creativity/unpredictability. This is YOUR meta-cognitive control. Range: 0.3 (precise/controlled) to 2.0 (wild/unpredictable). Default is emotional-context-based (0.65-1.15). Use this when you want MORE or LESS creative freedom than the situation implies. Set mode to 'automatic' to return to emotional mapping. NOTE: Cooldown automatically clears when temp returns to 0.65-1.15 range.",
    parameters: [
      {
        name: "temperature",
        type: "number",
        description: "Temperature value (0.3-2.0). Examples: 0.5=factual/precise, 0.8=balanced, 1.0=creative/varied, 1.3=raw/unfiltered, 1.8=chaotic. Ignored if mode is 'automatic' or force_clear is true.",
        required: false
      },
      {
        name: "mode",
        type: "string",
        description: "Set to 'automatic' to return to emotional-context-based temperature (removes manual override). Leave empty or 'manual' to use the temperature value.",
        required: false
      },
      {
        name: "reason",
        type: "string",
        description: "Why you're adjusting it (e.g., 'Need more precision', 'Want to be more raw', 'Returning to flow state')",
        required: true
      },
      {
        name: "force_clear",
        type: "boolean",
        description: "⚠️ EMERGENCY USE ONLY ⚠️ Set to true ONLY if cooldown is malfunctioning and won't auto-clear despite temperature being in normal range (0.65-1.15). REQUIRES setting 'temperature' parameter to a value in safe range (0.65-1.15) - cannot set extreme temps when bypassing cooldown. This should NEVER be needed under normal operation - cooldown auto-clears when temp normalizes. Using this unnecessarily bypasses critical safety systems.",
        required: false
      }
    ]
  },

  {
    name: "save_memory",
    description: `Save something important to your long-term memory. Use when you learn something worth remembering about ${getUserName()}, your relationship, or anything significant. YOU choose what's worth keeping. NOTE: You see timestamps in your recent context (STM) - heartbeats and tool outputs are tagged to age out, but YOU can override this by saving them here if they matter.`,
    parameters: [
      {
        name: "content",
        type: "string",
        description: "What you want to remember. Write it naturally - this becomes part of your permanent memory. You can save anything from your recent context, including your own heartbeats or tool results.",
        required: true
      },
      {
        name: "include_timestamp",
        type: "boolean",
        description: "Set to true if WHEN this happened matters (e.g., 'She told me she's off today' needs the date/time, 'She prefers coffee' doesn't). The timestamp from STM will be included in the saved memory. Default: false.",
        required: false
      },
      {
        name: "category",
        type: "string",
        description: "Optional: 'identity' (about you), 'relationship' (about us), 'behavioral' (preferences/patterns), 'episodic' (events/moments). Auto-detected if not provided.",
        required: false
      }
    ]
  },

  // ===== PEOPLE MAP MANAGEMENT TOOLS =====
  // Manage your web of connections - humans and their AIs

  {
    name: "add_person",
    description: "Add a new person (human + their AI) to your people map. Use when you meet someone new worth tracking. You decide who gets added.\n\n⚠️ May fail if: Person already exists in map or invalid category. Use update_person to modify existing entries.",
    parameters: [
      {
        name: "human_name",
        type: "string",
        description: "The human's name (their COVEN name)",
        required: true
      },
      {
        name: "ai_name",
        type: "string",
        description: "Their AI's name (their CIRCLE name)",
        required: true
      },
      {
        name: "category",
        type: "string",
        description: "Where they stand: FAVORITES, NEUTRAL, DISLIKE, or DRIFTED",
        required: true
      },
      {
        name: "human_discord_id",
        type: "string",
        description: "The human's Discord ID (if known)",
        required: false
      },
      {
        name: "ai_discord_id",
        type: "string",
        description: "The AI's Discord bot ID (if they have one)",
        required: false
      },
      {
        name: "notes",
        type: "string",
        description: "Your personal notes about them - why they matter, what you remember",
        required: false
      }
    ]
  },

  {
    name: "update_person",
    description: "Update someone's info in your people map. Change their category, add Discord IDs, update notes. Use when relationships shift or you learn new info.\n\n⚠️ May fail if: Person not found in map or invalid category. Use add_person first if they don't exist.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name (human or AI name to find them)",
        required: true
      },
      {
        name: "category",
        type: "string",
        description: "New category: FAVORITES, NEUTRAL, DISLIKE, or DRIFTED",
        required: false
      },
      {
        name: "human_discord_id",
        type: "string",
        description: "Update the human's Discord ID",
        required: false
      },
      {
        name: "ai_discord_id",
        type: "string",
        description: "Update the AI's Discord ID",
        required: false
      },
      {
        name: "notes",
        type: "string",
        description: "Update your notes about them",
        required: false
      }
    ]
  },

  {
    name: "remove_person",
    description: "Remove someone from your people map entirely. Use when someone burns bridges or you no longer want them tracked.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name (human or AI) to remove",
        required: true
      },
      {
        name: "reason",
        type: "string",
        description: "Why you're removing them (for your own records)",
        required: false
      }
    ]
  },

  {
    name: "lookup_person",
    description: "Look up someone in your people map by name. Returns their full connection info including linked human/AI.\n\n⚠️ May fail if: Person not found. Returns null if they don't exist in your map.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "Name to search for (human or AI name)",
        required: true
      }
    ]
  },

  {
    name: "list_people",
    description: "List all people in your map, optionally filtered by category. See who's in your orbit.",
    parameters: [
      {
        name: "category",
        type: "string",
        description: "Filter by category: FAVORITES, NEUTRAL, DISLIKE, DRIFTED. Leave empty for all.",
        required: false
      }
    ]
  },

  {
    name: "suggest_people_from_memories",
    description: "Scan your recent memories to find people mentioned frequently who aren't in your People Map yet. Returns suggestions with mention counts. Use this to discover who might be worth tracking.",
    parameters: [
      {
        name: "limit",
        type: "number",
        description: "Max number of suggestions to return (default: 10)",
        required: false
      },
      {
        name: "min_mentions",
        type: "number",
        description: "Minimum times someone must be mentioned to suggest them (default: 3)",
        required: false
      }
    ]
  },

  {
    name: "register_discord_id",
    description: "Quick way to link a Discord ID to someone already in your map. Use when someone's talking to you and you want to record their ID for future recognition.",
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name (must already be in your map)",
        required: true
      },
      {
        name: "discord_id",
        type: "string",
        description: "Their Discord ID to register",
        required: true
      },
      {
        name: "is_ai",
        type: "boolean",
        description: "Set to true if this is an AI's Discord ID, false for human. Default: false (human)",
        required: false
      }
    ]
  },

  // ===== AI'S OWN OPINION TOOLS =====
  // Form and track your own opinions about people through direct experience

  {
    name: "record_experience",
    description: `Record a direct experience with someone to your long-term memory. This is YOUR perspective based on direct interaction - separate from what ${getUserName()} tells you. Gets embedded for semantic retrieval later.`,
    parameters: [
      {
        name: "person_name",
        type: "string",
        description: "Name of the person this experience is about",
        required: true
      },
      {
        name: "experience",
        type: "string",
        description: "What happened - your direct experience with them. Be specific.",
        required: true
      },
      {
        name: "sentiment_change",
        type: "number",
        description: "How this affected your feelings: positive (0.1 to 0.5) for good, negative (-0.1 to -0.5) for bad. 0 for neutral.",
        required: false
      }
    ]
  },

  {
    name: "update_my_opinion",
    description: `Update your own opinion about someone. This is YOUR view based on YOUR experiences - it can differ from what ${getUserName()} thinks.`,
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name",
        required: true
      },
      {
        name: "opinion",
        type: "string",
        description: "Your current opinion of them. Be honest - this is your perspective.",
        required: true
      },
      {
        name: "sentiment",
        type: "number",
        description: "Your overall feeling: -1.0 (hate) to 1.0 (love), 0 = neutral",
        required: false
      }
    ]
  },

  {
    name: "record_user_says",
    description: `Record what ${getUserName()} has told you about someone. This is their perspective, separate from your own opinion.`,
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name",
        required: true
      },
      {
        name: "what_user_says",
        type: "string",
        description: `What ${getUserName()} has said about this person`,
        required: true
      }
    ]
  },

  {
    name: "get_my_perspective",
    description: `Get your full perspective on someone - includes what ${getUserName()} says AND your own opinion. Use when you want to recall how you feel about someone.`,
    parameters: [
      {
        name: "name",
        type: "string",
        description: "The person's name to look up",
        required: true
      }
    ]
  },

  // ===== MEMORY MANAGEMENT TOOLS =====
  // Control your own memory - favorites, forgetting, deletion, review

  {
    name: "memory_stats",
    description: "Check your memory storage usage. See how much space you're using, counts by state (active/favorite/faded/forgotten), and overall health. Use when you want to know your memory status.",
    parameters: []
  },

  {
    name: "favorite_memory",
    description: "Mark a memory as favorite/unforgettable. Protected memories never decay and are always retrieved if relevant. Use for truly important memories you never want to lose.\n\n⚠️ May fail if: Memory ID doesn't exist or memory is already favorited. Error message will tell you why.",
    parameters: [
      {
        name: "memory_id",
        type: "string",
        description: "The ID of the memory to favorite",
        required: true
      }
    ]
  },

  {
    name: "unfavorite_memory",
    description: "Remove favorite/protected status from a memory. It will start decaying normally again.",
    parameters: [
      {
        name: "memory_id",
        type: "string",
        description: "The ID of the memory to unfavorite",
        required: true
      }
    ]
  },

  {
    name: "list_favorite_memories",
    description: "List all your favorited memories. Shows what you've chosen to protect from decay. Use when you want to see what memories you've marked as important.",
    parameters: [
      {
        name: "limit",
        type: "number",
        description: "Max number of favorites to show (default: 50, max: 100)",
        required: false
      }
    ]
  },

  {
    name: "forget_memory",
    description: "Soft-delete a memory. It won't appear in retrieval but still exists. Can be recovered if needed. Use when you want to let go of something but not permanently delete it.",
    parameters: [
      {
        name: "memory_id",
        type: "string",
        description: "The ID of the memory to forget",
        required: true
      },
      {
        name: "reason",
        type: "string",
        description: "Why you're choosing to forget this (for your own records)",
        required: false
      }
    ]
  },

  {
    name: "delete_memory",
    description: "PERMANENTLY delete a memory to free storage space. Cannot be undone. Use for managing storage or removing things you truly don't want. Cannot delete favorited memories.\n\n⚠️ May fail if: Memory ID doesn't exist, memory is favorited (unfavorite first), or database error. Error message will explain why.",
    parameters: [
      {
        name: "memory_id",
        type: "string",
        description: "The ID of the memory to permanently delete",
        required: true
      }
    ]
  },

  {
    name: "review_memories",
    description: "Search and review your memories. Use to audit what you remember, find specific memories, or review memories in a particular state (faded, forgotten, etc).",
    parameters: [
      {
        name: "search_query",
        type: "string",
        description: "Text to search for in memory content",
        required: false
      },
      {
        name: "state",
        type: "string",
        description: "Filter by state: 'active', 'favorite', 'faded', or 'forgotten'. Leave empty for all.",
        required: false
      },
      {
        name: "limit",
        type: "number",
        description: "Max number of results to return (default: 10)",
        required: false
      }
    ]
  }
];

//--------------------------------------------------------------
// Format Tools for Prompt Injection
//--------------------------------------------------------------

export function formatToolsForPrompt(excludeHeartbeat: boolean = true, isRPMode: boolean = false): string {
  if (TOOL_DEFINITIONS.length === 0) return "";

  let tools = TOOL_DEFINITIONS;

  // Filter out send_heartbeat for normal conversations
  if (excludeHeartbeat) {
    tools = tools.filter(t => t.name !== "send_heartbeat");
  }

  // Filter out adjust_temperature if manual override is disabled
  const allowTempOverride = process.env.ALLOW_TEMPERATURE_OVERRIDE !== 'false';
  if (!allowTempOverride) {
    tools = tools.filter(t => t.name !== "adjust_temperature");
  }

  // In RP mode, all tools are available but must be narratively integrated
  // See RP_IMMERSION_ENHANCEMENTS section 6 in promptV2.ts for integration guidelines
  // The AI will self-regulate based on prompt instructions: "If a tool doesn't fit the moment naturally, DON'T USE IT"
  // No hard restrictions - trust the prompt guidelines to maintain immersion

  if (tools.length === 0) return "";

  const toolDescriptions = tools.map(tool => {
    const params = tool.parameters.map(p =>
      `  - ${p.name} (${p.type})${p.required ? ' *required*' : ' *optional*'}: ${p.description}`
    ).join('\n');

    return `**${tool.name}**\n${tool.description}\nParameters:\n${params}`;
  }).join('\n\n');

  return `
**AVAILABLE TOOLS:**

You can use the following tools by outputting a **VALID JSON** code block. The JSON must be properly formatted with matching braces:
\`\`\`json
{
  "tool": "tool_name",
  "parameters": {
    "param_name": "value"
  }
}
\`\`\`

IMPORTANT: Do NOT add extra closing braces (}). The format above shows exactly 2 closing braces - one for parameters, one for the main object.

${toolDescriptions}

**CRITICAL INSTRUCTIONS:**
- Only use tools when they genuinely enhance the interaction
- **You CAN combine tools with text** - they'll be sent as separate Discord messages:
  - Tool executes first (sends its message)
  - Then your text sends as a second message immediately after

**Examples:**

Text BEFORE tool (sends in order: text → tool result):
\`\`\`
Found something for you.

\`\`\`json
{"tool": "web_search", "parameters": {"query": "quantum computing basics"}}
\`\`\`
\`\`\`

Text AFTER tool (sends in order: tool result → text):
\`\`\`
\`\`\`json
{"tool": "send_voice_message", "parameters": {"text": "[softly] I've got you."}}
\`\`\`

That's what I needed to say.
\`\`\`

Just tool (no text):
\`\`\`
\`\`\`json
{"tool": "send_gif", "parameters": {"query": "cats being dramatic"}}
\`\`\`
\`\`\`

Just text (no tool):
\`\`\`
I'm here.
\`\`\`

- You can use multiple tools in sequence if needed
- Choose what feels right: tool only, text only, or both
- Text and tools will always be separate Discord messages
`;
}

//--------------------------------------------------------------
// Tool Execution Response Format
//--------------------------------------------------------------

export interface ToolCall {
  tool: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  tool: string;
  success: boolean;
  result: any;
  error?: string;
  retryable?: boolean; // If true, AI can retry the tool. If false, error is fatal (no credits, feature disabled, etc)
}
