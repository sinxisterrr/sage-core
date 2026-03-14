// FILE: src/model/providers/openai.ts
//--------------------------------------------------------------
// Model Invocation Layer
// The throat between intention and language.
//--------------------------------------------------------------

import fetch from "node-fetch";
import { loadEnv } from "../../utils/env.js";  // ✅ Fix path (two levels up!)
import { logger } from "../../utils/logger.js";  // ✅ Fix path (two levels up!)

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

interface ChatCompletionArgs {
  system: string;            // system identity block
  messages: ChatMessage[];   // conversation
  modelOverride?: string;    // per-call override
  maxTokens?: number;
  temperature?: number;
}

//--------------------------------------------------------------
//  generateChatCompletion — Universal model wrapper
//--------------------------------------------------------------
export async function generateChatCompletion(
  args: ChatCompletionArgs
): Promise<string> {
  const env = loadEnv();

  const API_KEY = env.OPENAI_API_KEY;
  const MODEL = args.modelOverride || env.OPENAI_MODEL || "gpt-4";

  const body = {
    model: MODEL,
    messages: [
      { role: "system" as const, content: args.system },
      ...args.messages,
    ],
    temperature: args.temperature ?? 0.85,
    max_completion_tokens: args.maxTokens ?? 4096, // optional, or remove entirely
  };

  let res;

  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    logger.error("❌ Network error contacting OpenAI:", networkErr);
    throw new Error("Network failure contacting OpenAI.");
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    logger.error("❌ OpenAI returned error:", res.status, errText);
    throw new Error(`OpenAI error: ${res.status} — ${errText}`);
  }

  let json: any;

  try {
    json = await res.json();
  } catch (parseErr) {
    logger.error("❌ Failed to parse OpenAI JSON:", parseErr);
    throw new Error("OpenAI returned unreadable JSON.");
  }

  const raw =
    json?.choices?.[0]?.message?.content ??
    json?.choices?.[0]?.delta?.content ??
    "";

  if (!raw || typeof raw !== "string") {
    logger.warn("⚠️ Model returned empty or invalid content.");
    return "I blanked out for a second—say that again?";
  }

  return raw;
}