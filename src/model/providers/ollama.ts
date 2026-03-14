import fetch from "node-fetch";
import { logger } from "../../utils/logger.js";

export async function ollamaCompletion(model: string, messages: any[], temperature?: number): Promise<string> {
  try {
    // If OLLAMA_API_KEY is set → use Ollama Cloud as remote host
    // Otherwise → use local Ollama (default localhost)
    const isCloud = !!process.env.OLLAMA_API_KEY;

    const base =
      process.env.OLLAMA_BASE_URL ||
      (isCloud ? "https://ollama.com" : "http://localhost:11434");

    // In both local + cloud modes, ollama.com acts as an Ollama host
    // and uses the same /api/chat endpoint (doc: "remote Ollama host")
    const url = `${base}/api/chat`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Cloud auth exactly as docs show: Bearer OLLAMA_API_KEY
    if (isCloud) {
      if (!process.env.OLLAMA_API_KEY) {
        throw new Error("OLLAMA_API_KEY is required for Ollama Cloud.");
      }
      headers["Authorization"] = `Bearer ${process.env.OLLAMA_API_KEY}`;
    }

    const body = {
      model,
      messages,
      stream: false,
      // options are fine for both local + cloud; cloud acts as remote Ollama host
      options: {
        temperature: temperature ?? 0.85, // Default to 0.85 for consistency with other providers
        num_ctx: parseInt(process.env.OLLAMA_CONTEXT_LENGTH || "32768", 10),
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error("Ollama error:", res.status, text);
      throw new Error(`Ollama error: ${res.status}`);
    }

    const json: any = await res.json();

    // Cloud + local /api/chat both return a `message` object
    return (
      json?.message?.content ||
      json?.response ||
      json?.choices?.[0]?.message?.content ||
      ""
    );
  } catch (err) {
    logger.error("Ollama connection failed:", err);
    throw new Error("Unable to reach Ollama backend.");
  }
}
