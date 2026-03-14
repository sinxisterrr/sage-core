// FILE: src/model/CrewAI.ts
//--------------------------------------------------------------
// Lightweight multi-agent orchestration with dynamic model selection
// Supports: Ollama, OpenAI, OpenRouter, Anthropic
//--------------------------------------------------------------

import { generateModelOutput } from "./Llm.js";
import { logger } from "../utils/logger.js";

export interface CrewAIRequest {
  system: string;
  messages: any[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Generates model output using multi-agent approach
 * The AI can intelligently choose which model to use based on the task
 */
export async function generateCrewAIOutput(input: CrewAIRequest): Promise<string> {
  try {
    const verbose = process.env.CREWAI_VERBOSE === "true";
    const provider = (process.env.MODEL_PROVIDER || "ollama").toLowerCase();

    // Get available models from env based on provider
    let availableModels: string[] = [];
    let defaultModel = "";

    switch (provider) {
      case "ollama":
        availableModels = (
          process.env.CREWAI_AVAILABLE_MODELS ||
          process.env.OLLAMA_MODEL ||
          "llama3.1:8b"
        )
          .split(",")
          .map((m) => m.trim());
        defaultModel = process.env.OLLAMA_MODEL || availableModels[0];
        break;

      case "openai":
        availableModels = (
          process.env.CREWAI_AVAILABLE_MODELS ||
          "gpt-4,gpt-3.5-turbo"
        )
          .split(",")
          .map((m) => m.trim());
        defaultModel = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
        break;

      case "openrouter":
        availableModels = (
          process.env.CREWAI_AVAILABLE_MODELS ||
          "openai/gpt-4,anthropic/claude-3-sonnet"
        )
          .split(",")
          .map((m) => m.trim());
        defaultModel =
          process.env.OPENROUTER_MODEL || "anthropic/claude-3-sonnet";
        break;

      case "anthropic":
        availableModels = (
          process.env.CREWAI_AVAILABLE_MODELS ||
          "claude-3-5-sonnet-20241022,claude-3-haiku-20240307"
        )
          .split(",")
          .map((m) => m.trim());
        defaultModel =
          process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";
        break;

      default:
        availableModels = [defaultModel];
    }

    // Use first available model as default
    const defaultSelectedModel = availableModels[0] || defaultModel;
    const allowAiModelSelection =
      process.env.CREWAI_AI_MODEL_SELECTION === "true";

    // Build the full conversation context
    const messages: any[] = [];
    if (input.system) {
      messages.push({ role: "system", content: input.system });
    }
    if (input.messages?.length) {
      messages.push(...input.messages);
    }

    // Extract the user's most recent message
    const userMessages = messages.filter((m) => m.role === "user");
    const userQuery =
      userMessages[userMessages.length - 1]?.content ||
      "Help me with this task.";

    // Build context from conversation history
    const conversationContext = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");

    if (verbose) {
      logger.info("🤖 Starting multi-agent workflow...");
      logger.info(`📊 Provider: ${provider}`);
    }

    // PHASE 1: Context Analysis + Model Selection
    if (verbose) {
      logger.info(`📊 Phase 1: Analyzing context...`);
    }

    let analysisContent = `Analyze this conversation and provide a brief summary of:
1. User's main intent/request
2. Key context points that matter for the response
3. Tone/sentiment

Conversation:
${conversationContext}

Latest request: ${userQuery}

Provide a concise analysis (2-3 sentences max).`;

    // If AI model selection is enabled, let the AI choose the model
    if (allowAiModelSelection && availableModels.length > 1) {
      analysisContent += `\n\nAVAILABLE MODELS: ${availableModels.join(", ")}

You MUST choose which model to use for this response. Each model has different strengths:
- Different models excel at different tasks (reasoning, creativity, speed, accuracy)
- Choose based on the SPECIFIC needs of THIS request
- Don't always default to the same model
- Consider task type: conversational, analytical, creative, technical, simple vs complex

Analyze the user's request and select the BEST model for THIS specific task.
Be decisive and varied in your choices - use all available models appropriately.

Add a line at the end: "RECOMMENDED_MODEL: <exact_model_name>"`;
    }

    const analysisPrompt = {
      system:
        "You are a conversation analyst. Your job is to analyze user messages and extract key context, intent, and important details. Be concise and focus on what matters.",
      messages: [
        {
          role: "user" as const,
          content: analysisContent,
        },
      ],
    };

    const analysis = await generateModelOutput({
      system: analysisPrompt.system,
      messages: analysisPrompt.messages,
      modelOverride: defaultSelectedModel,
      temperature: 0.7, // Higher temperature for more varied/genuine model selection
    });

    // Extract model recommendation if AI model selection is enabled
    let selectedModel = defaultSelectedModel;
    if (allowAiModelSelection && availableModels.length > 1) {
      const modelMatch = analysis.match(/RECOMMENDED_MODEL:\s*(.+)/i);
      if (modelMatch) {
        const recommended = modelMatch[1].trim();
        // Verify it's in the available models list
        if (availableModels.includes(recommended)) {
          selectedModel = recommended;
          if (verbose) {
            logger.info(`🎯 AI selected model: ${selectedModel}`);
            logger.info(`📋 Full analysis:\n${analysis}`);
          }
        } else if (verbose) {
          logger.warn(
            `⚠️ AI recommended unavailable model "${recommended}", using default: ${defaultSelectedModel}`
          );
          logger.info(`Available models were: ${availableModels.join(", ")}`);
        }
      } else if (verbose) {
        logger.warn(
          `⚠️ No model recommendation found in analysis, using default: ${defaultSelectedModel}`
        );
        logger.info(`📋 Analysis output:\n${analysis}`);
      }
    }

    if (verbose) {
      logger.info(`✅ Analysis complete`);
    }

    // PHASE 2: Response Generation
    logger.info(`🤖 Using model: ${selectedModel}`);
    if (verbose) {
      logger.info(`💬 Phase 2: Generating response...`);
    }

    const responsePrompt = {
      system: input.system,
      messages: [
        ...messages,
        {
          role: "system" as const,
          content: `[CONTEXT ANALYSIS]
${analysis.replace(/RECOMMENDED_MODEL:.+/i, "").trim()}

Use this analysis to inform your response, but respond naturally as yourself. Don't mention the analysis.`,
        },
      ],
    };

    const response = await generateModelOutput({
      system: responsePrompt.system,
      messages: responsePrompt.messages,
      modelOverride: selectedModel,
      temperature: input.temperature ?? 0.8,
      maxTokens: input.maxTokens,
    });

    if (verbose) {
      logger.info("✅ Multi-agent workflow complete");
    }

    return response;
  } catch (err: any) {
    logger.error(`❌ Multi-agent workflow failed: ${err.message}`);
    logger.warn("⚠️ Falling back to direct model call...");

    // Fallback to direct model call if multi-agent fails
    return generateModelOutput(input);
  }
}
