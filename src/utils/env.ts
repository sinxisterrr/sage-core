//--------------------------------------------------------------
// Environment loader — typed and safe
//--------------------------------------------------------------

import dotenv from "dotenv";
dotenv.config();

export interface EnvConfig {
  DISCORD_BOT_TOKEN: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
  MODEL_PROVIDER: string;
  OLLAMA_MODEL?: string;
  OLLAMA_BASE_URL?: string;
  OLLAMA_API_KEY?: string;
  CLAUDE_API_KEY?: string;
  CLAUDE_MODEL?: string;
  RUNPOD_OLLAMA_URL?: string;
  RUNPOD_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

export function loadEnv(): EnvConfig {
  const {
    DISCORD_BOT_TOKEN,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    MODEL_PROVIDER,
    OLLAMA_MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_API_KEY,
    CLAUDE_API_KEY,
    CLAUDE_MODEL,
    RUNPOD_OLLAMA_URL,
    RUNPOD_API_KEY,
    OPENROUTER_API_KEY,
    OPENROUTER_MODEL,
  } = process.env;

  if (!DISCORD_BOT_TOKEN) throw new Error("Missing DISCORD_BOT_TOKEN");

  return {
    DISCORD_BOT_TOKEN,
    OPENAI_API_KEY,
    OPENAI_MODEL: OPENAI_MODEL || "gpt-4o",

    MODEL_PROVIDER: MODEL_PROVIDER || "openai",

    OLLAMA_MODEL,
    OLLAMA_BASE_URL,
    OLLAMA_API_KEY,

    CLAUDE_API_KEY,
    CLAUDE_MODEL: CLAUDE_MODEL || "claude-3-sonnet-20240229",

    RUNPOD_OLLAMA_URL,
    RUNPOD_API_KEY,

    OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    
  };
}
