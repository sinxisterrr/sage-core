// FILE: src/discord/events/messageCreate.ts
//--------------------------------------------------------------
import { Events, Message } from "discord.js";
import { logger } from "../../utils/logger.js";
import { handleMessage } from "../../core/handleMessage.js";
import { autonomousSystem } from "../../index.js";

export const messageCreateEvent = {
  name: Events.MessageCreate,
  once: false,
  async execute(message: Message) {
    try {
      // Ignore own messages (prevent self-loops)
      if (message.author.id === message.client.user?.id) return;

      // DIAGNOSTIC: Log if message is from a bot
      if (message.author.bot) {
        logger.info(`🤖 Received message from BOT: ${message.author.username} (${message.author.id})`);
      } else {
        logger.info(`👤 Received message from HUMAN: ${message.author.username} (${message.author.id})`);
      }

      // Track all messages for conversation context
      autonomousSystem?.trackMessage(message);

      // Use autonomous system to decide if we should respond
      if (autonomousSystem) {
        const decision = autonomousSystem.shouldRespond(message);
        if (!decision.shouldRespond) {
          logger.info(`🚫 Not responding: ${decision.reason}`);
          return;
        }
        logger.info(`✅ Responding: ${decision.reason}`);
      } else if (message.author.bot) {
        // Fallback if autonomous system not initialized yet
        return;
      }

      // handleMessage already sends the reply, so don't send it again here!
      await handleMessage(message);
    } catch (err) {
      logger.error("❌ Failed to handle message:", err);
    }
  },
};
