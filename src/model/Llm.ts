//--------------------------------------------------------------
// FILE: src/model/Llm.ts
// Unified Model Output Generator (symmetrical + safe)
//--------------------------------------------------------------

import { loadEnv } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { generateChatCompletion as openAICompletion } from "./providers/openai.js";
import { ollamaCompletion } from "./providers/ollama.js";

let providerLogged = false;

export async function generateModelOutput(args: {
  system: string;
  messages: any[];
  modelOverride?: string;
  maxTokens?: number;
  temperature?: number;
}) {
  const { MODEL_PROVIDER, OPENAI_MODEL, OLLAMA_MODEL, OPENROUTER_MODEL } = loadEnv();
  const provider = MODEL_PROVIDER?.toLowerCase() || "openrouter";
  if (!provider) throw new Error("MODEL_PROVIDER must be set (e.g., 'ollama' or 'openai').");

  if (!providerLogged) {
    logger.info(`🧠 Provider: ${provider}`);
    providerLogged = true;
  }

  const model =
    args.modelOverride ||
    (provider === "ollama" ? OLLAMA_MODEL :
     provider === "openrouter" ? OPENROUTER_MODEL :
     OPENAI_MODEL);

//     console.error("OpenRouter full error:", json);
  if (!model) throw new Error(`Model not defined for provider '${provider}'.`);

  // Log which model is being used
  logger.info(`🤖 Using model: ${model}`);

  // 📄 Normalized payload for both
  const payload = {
    model,
    messages: args.messages,
    system: args.system,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
  };

  // 🌙 Dispatch
  if (provider === "ollama") {
    // 🧠 Ensure the system context is included
    const messages = [
      { role: "system", content: payload.system },
      ...payload.messages
    ];

    return ollamaCompletion(payload.model, messages, payload.temperature ?? 0.85);
  }

  if (provider === "openai") {
    // OpenAI expects an object
    return openAICompletion(payload);
  }

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://railway.app",
        "X-Title": "Discord Bot"
      },
      body: JSON.stringify({
        model: payload.model,
        messages: [
          { role: "system", content: payload.system },
          ...payload.messages
        ],
        temperature: payload.temperature ?? 0.85,
        max_tokens: payload.maxTokens ?? 512
      })
    });

    const json = await res.json();

    // Throw OpenRouter error properly
    if (json.error) {
      throw new Error(`OpenRouter error: ${json.error.message}`);
    }

    const content =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      json?.choices?.[0]?.delta?.content ??
      json?.output_text ??
      "";

    return content;  // ✅ FIXED: Added missing return statement
  }

  throw new Error(`Unsupported MODEL_PROVIDER: ${provider}`);
}