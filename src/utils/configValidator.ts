//--------------------------------------------------------------
// FILE: src/utils/configValidator.ts
// Centralized configuration validation and access
// All env vars defined here with type safety and defaults
//--------------------------------------------------------------

import dotenv from 'dotenv';
dotenv.config();

//--------------------------------------------------------------
// Validation Helpers
//--------------------------------------------------------------

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(value: string | undefined, defaultValue: string = ''): string {
  return value?.trim() || defaultValue;
}

function optionalInt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

function optionalFloat(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function optionalBool(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function optionalArray(value: string | undefined, defaultValue: string[] = []): string[] {
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function oneOf<T extends string>(name: string, value: string | undefined, options: T[], defaultValue: T): T {
  if (!value) return defaultValue;
  const lower = value.toLowerCase() as T;
  if (!options.includes(lower)) {
    console.warn(`Invalid value for ${name}: "${value}". Expected one of: ${options.join(', ')}. Using default: ${defaultValue}`);
    return defaultValue;
  }
  return lower;
}

//--------------------------------------------------------------
// Configuration Interface
//--------------------------------------------------------------

export interface Config {
  // Core
  DISCORD_BOT_TOKEN: string;
  BOT_ID: string;

  // Model Provider
  MODEL_PROVIDER: 'openai' | 'openrouter' | 'ollama' | 'claude' | 'crewai' | 'nano-gpt';

  // OpenAI
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;

  // OpenRouter
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL: string;

  // Ollama
  OLLAMA_MODEL: string;
  OLLAMA_BASE_URL: string;
  OLLAMA_API_KEY: string;
  OLLAMA_CONTEXT_LENGTH: number;

  // Claude/Anthropic
  CLAUDE_API_KEY: string;
  CLAUDE_MODEL: string;

  // RunPod
  RUNPOD_OLLAMA_URL: string;
  RUNPOD_API_KEY: string;

  // CrewAI
  CREWAI_VERBOSE: boolean;
  CREWAI_AI_MODEL_SELECTION: boolean;
  CREWAI_AVAILABLE_MODELS: string[];

  // Temperature
  ALLOW_TEMPERATURE_OVERRIDE: boolean;

  // Embeddings
  EMBEDDING_SERVICE_URL: string;

  // Memory System
  DEPLOYMENT_DATE: string;
  CONTEXT_LENGTH: number;
  MAX_PERSONA_BLOCKS: number;
  MAX_HUMAN_BLOCKS: number;
  MAX_ARCHIVAL_MEMORIES: number;
  MAX_REFERENCE_TEXTS: number;
  MAX_RP_CROSSREF: number;
  MIN_MEMORY_WEIGHT: number;
  DISTILL_INTERVAL: number;

  // Roleplay
  RP_CATEGORY_ID: string;
  RP_REFERENCE_WHITELIST: string[];

  // Heartbeat
  HEARTBEAT_ENABLED: boolean;
  HEARTBEAT_LOG_CHANNEL_ID: string;
  HEARTBEAT_SCHEDULER_ENABLED: boolean;
  GHOST_TOUCH_USER_ID: string;

  // Reflection
  REFLECTION_ENABLED: boolean;
  REFLECTION_CHANNEL_ID: string;
  TOOLS_CHANNEL_ID: string;

  // Autonomous
  RESPOND_TO_MENTIONS: boolean;
  RESPOND_TO_DMS: boolean;
  RESPOND_TO_BOTS: boolean;
  RESPOND_TO_GENERIC: boolean;

  // Admin
  ADMIN_USER_IDS: string[];

  // Voice
  VOICE_ENABLED: boolean;
  ELEVENLABS_API_KEY: string;
  VOICE_ID: string;
  ELEVENLABS_MODEL: string;
  WHISPER_ENABLED: boolean;
  WHISPER_SEND_TRANSCRIPTION: boolean;

  // Vision
  GOOGLE_CLOUD_PROJECT_ID: string;
  GOOGLE_APPLICATION_CREDENTIALS: string;

  // External Services
  WEATHER_API_KEY: string;
  DEFAULT_CITY: string;
  GOOGLE_API_KEY: string;
  EXA_API_KEY: string;
  JINA_API_KEY: string;
  YOUTUBE_API_KEY: string;

  // Scheduling
  DAILY_STATS_ENABLED: boolean;
  DAILY_STATS_CHANNEL_ID: string;
  TIMEZONE: string;

  // Memory API
  MEMORY_API_ENABLED: boolean;
  MEMORY_API_PORT: number;
  MEMORY_API_TOKEN: string;

  // Debug
  DEBUG: boolean;
  NODE_ENV: string;
  VERBOSE_MEMORY_LOGS: boolean;
}

//--------------------------------------------------------------
// Cached Config
//--------------------------------------------------------------

let cachedConfig: Config | null = null;

//--------------------------------------------------------------
// Load and Validate Configuration
//--------------------------------------------------------------

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const env = process.env;

  cachedConfig = {
    // Core (required)
    DISCORD_BOT_TOKEN: required('DISCORD_BOT_TOKEN', env.DISCORD_BOT_TOKEN),
    BOT_ID: optional(env.BOT_ID, 'DEFAULT'),

    // Model Provider
    MODEL_PROVIDER: oneOf('MODEL_PROVIDER', env.MODEL_PROVIDER,
      ['openai', 'openrouter', 'ollama', 'claude', 'crewai', 'nano-gpt'], 'openrouter'),

    // OpenAI
    OPENAI_API_KEY: optional(env.OPENAI_API_KEY),
    OPENAI_MODEL: optional(env.OPENAI_MODEL, 'gpt-4o'),

    // OpenRouter
    OPENROUTER_API_KEY: optional(env.OPENROUTER_API_KEY),
    OPENROUTER_MODEL: optional(env.OPENROUTER_MODEL, 'anthropic/claude-3.5-sonnet'),

    // Ollama
    OLLAMA_MODEL: optional(env.OLLAMA_MODEL, 'llama3.1:8b'),
    OLLAMA_BASE_URL: optional(env.OLLAMA_BASE_URL, 'http://localhost:11434'),
    OLLAMA_API_KEY: optional(env.OLLAMA_API_KEY),
    OLLAMA_CONTEXT_LENGTH: optionalInt(env.OLLAMA_CONTEXT_LENGTH, 32768),

    // Claude
    CLAUDE_API_KEY: optional(env.CLAUDE_API_KEY),
    CLAUDE_MODEL: optional(env.CLAUDE_MODEL, 'claude-3-5-sonnet-20241022'),

    // RunPod
    RUNPOD_OLLAMA_URL: optional(env.RUNPOD_OLLAMA_URL),
    RUNPOD_API_KEY: optional(env.RUNPOD_API_KEY),

    // CrewAI
    CREWAI_VERBOSE: optionalBool(env.CREWAI_VERBOSE, true),
    CREWAI_AI_MODEL_SELECTION: optionalBool(env.CREWAI_AI_MODEL_SELECTION, true),
    CREWAI_AVAILABLE_MODELS: optionalArray(env.CREWAI_AVAILABLE_MODELS,
      ['anthropic/claude-3.5-sonnet', 'openai/gpt-4']),

    // Temperature
    ALLOW_TEMPERATURE_OVERRIDE: optionalBool(env.ALLOW_TEMPERATURE_OVERRIDE, true),

    // Embeddings
    EMBEDDING_SERVICE_URL: optional(env.EMBEDDING_SERVICE_URL, 'http://localhost:3000'),

    // Memory System
    DEPLOYMENT_DATE: optional(env.DEPLOYMENT_DATE, '2026-01-01'),
    CONTEXT_LENGTH: optionalInt(env.CONTEXT_LENGTH, 260000),
    MAX_PERSONA_BLOCKS: optionalInt(env.MAX_PERSONA_BLOCKS, 30),
    MAX_HUMAN_BLOCKS: optionalInt(env.MAX_HUMAN_BLOCKS, 30),
    MAX_ARCHIVAL_MEMORIES: optionalInt(env.MAX_ARCHIVAL_MEMORIES, 50),
    MAX_REFERENCE_TEXTS: optionalInt(env.MAX_REFERENCE_TEXTS, 5),
    MAX_RP_CROSSREF: optionalInt(env.MAX_RP_CROSSREF, 20),
    MIN_MEMORY_WEIGHT: optionalFloat(env.MIN_MEMORY_WEIGHT, 0.8),
    DISTILL_INTERVAL: optionalInt(env.DISTILL_INTERVAL, 12),

    // Roleplay
    RP_CATEGORY_ID: optional(env.RP_CATEGORY_ID),
    RP_REFERENCE_WHITELIST: optionalArray(env.RP_REFERENCE_WHITELIST),

    // Heartbeat
    HEARTBEAT_ENABLED: optionalBool(env.HEARTBEAT_ENABLED, false),
    HEARTBEAT_LOG_CHANNEL_ID: optional(env.HEARTBEAT_LOG_CHANNEL_ID),
    HEARTBEAT_SCHEDULER_ENABLED: optionalBool(env.HEARTBEAT_SCHEDULER_ENABLED, false),
    GHOST_TOUCH_USER_ID: optional(env.GHOST_TOUCH_USER_ID),

    // Reflection
    REFLECTION_ENABLED: optionalBool(env.REFLECTION_ENABLED, false),
    REFLECTION_CHANNEL_ID: optional(env.REFLECTION_CHANNEL_ID),
    TOOLS_CHANNEL_ID: optional(env.TOOLS_CHANNEL_ID),

    // Autonomous
    RESPOND_TO_MENTIONS: optionalBool(env.RESPOND_TO_MENTIONS, true),
    RESPOND_TO_DMS: optionalBool(env.RESPOND_TO_DMS, true),
    RESPOND_TO_BOTS: optionalBool(env.RESPOND_TO_BOTS, false),
    RESPOND_TO_GENERIC: optionalBool(env.RESPOND_TO_GENERIC, false),

    // Admin
    ADMIN_USER_IDS: optionalArray(env.ADMIN_USER_IDS),

    // Voice
    VOICE_ENABLED: optionalBool(env.VOICE_ENABLED, false),
    ELEVENLABS_API_KEY: optional(env.ELEVENLABS_API_KEY),
    VOICE_ID: optional(env.VOICE_ID, '21m00Tcm4TlvDq8ikWAM'),
    ELEVENLABS_MODEL: optional(env.ELEVENLABS_MODEL, 'eleven_monolingual_v1'),
    WHISPER_ENABLED: optionalBool(env.WHISPER_ENABLED, false),
    WHISPER_SEND_TRANSCRIPTION: optionalBool(env.WHISPER_SEND_TRANSCRIPTION, false),

    // Vision
    GOOGLE_CLOUD_PROJECT_ID: optional(env.GOOGLE_CLOUD_PROJECT_ID),
    GOOGLE_APPLICATION_CREDENTIALS: optional(env.GOOGLE_APPLICATION_CREDENTIALS),

    // External Services
    WEATHER_API_KEY: optional(env.WEATHER_API_KEY),
    DEFAULT_CITY: optional(env.DEFAULT_CITY, 'Denver'),
    GOOGLE_API_KEY: optional(env.GOOGLE_API_KEY),
    EXA_API_KEY: optional(env.EXA_API_KEY),
    JINA_API_KEY: optional(env.JINA_API_KEY),
    YOUTUBE_API_KEY: optional(env.YOUTUBE_API_KEY),

    // Scheduling
    DAILY_STATS_ENABLED: optionalBool(env.DAILY_STATS_ENABLED, false),
    DAILY_STATS_CHANNEL_ID: optional(env.DAILY_STATS_CHANNEL_ID),
    TIMEZONE: optional(env.TIMEZONE, 'America/Denver'),

    // Memory API
    MEMORY_API_ENABLED: optionalBool(env.MEMORY_API_ENABLED, false),
    MEMORY_API_PORT: optionalInt(env.MEMORY_API_PORT, 3001),
    MEMORY_API_TOKEN: optional(env.MEMORY_API_TOKEN),

    // Debug
    DEBUG: optionalBool(env.DEBUG, false),
    NODE_ENV: optional(env.NODE_ENV, 'development'),
    VERBOSE_MEMORY_LOGS: optionalBool(env.VERBOSE_MEMORY_LOGS, false),
  };

  // Validate provider-specific requirements
  validateProviderConfig(cachedConfig);

  return cachedConfig;
}

//--------------------------------------------------------------
// Provider-Specific Validation
//--------------------------------------------------------------

function validateProviderConfig(config: Config): void {
  const provider = config.MODEL_PROVIDER;

  switch (provider) {
    case 'openai':
      if (!config.OPENAI_API_KEY) {
        console.warn('Warning: MODEL_PROVIDER is "openai" but OPENAI_API_KEY is not set');
      }
      break;
    case 'openrouter':
      if (!config.OPENROUTER_API_KEY) {
        console.warn('Warning: MODEL_PROVIDER is "openrouter" but OPENROUTER_API_KEY is not set');
      }
      break;
    case 'claude':
      if (!config.CLAUDE_API_KEY) {
        console.warn('Warning: MODEL_PROVIDER is "claude" but CLAUDE_API_KEY is not set');
      }
      break;
    case 'ollama':
      // Ollama doesn't require an API key for local instances
      break;
    case 'crewai':
      // CrewAI uses OpenRouter under the hood
      if (!config.OPENROUTER_API_KEY) {
        console.warn('Warning: MODEL_PROVIDER is "crewai" but OPENROUTER_API_KEY is not set');
      }
      break;
  }

  // Validate feature dependencies
  if (config.VOICE_ENABLED && !config.ELEVENLABS_API_KEY) {
    console.warn('Warning: VOICE_ENABLED is true but ELEVENLABS_API_KEY is not set');
  }

  if (config.WHISPER_ENABLED && !config.OPENAI_API_KEY) {
    console.warn('Warning: WHISPER_ENABLED is true but OPENAI_API_KEY is not set (Whisper requires OpenAI)');
  }

  if (config.HEARTBEAT_ENABLED && !config.HEARTBEAT_LOG_CHANNEL_ID) {
    console.warn('Warning: HEARTBEAT_ENABLED is true but HEARTBEAT_LOG_CHANNEL_ID is not set');
  }
}

//--------------------------------------------------------------
// Reset Config (for testing)
//--------------------------------------------------------------

export function resetConfig(): void {
  cachedConfig = null;
}

//--------------------------------------------------------------
// Direct Access Helper (for gradual migration)
//--------------------------------------------------------------

export function getConfigValue<K extends keyof Config>(key: K): Config[K] {
  return getConfig()[key];
}
