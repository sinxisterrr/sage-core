// FILE: src/discord/events/ready.ts
//--------------------------------------------------------------
import { Events, Client, TextChannel } from "discord.js";
import { logger } from "../../utils/logger.js";
import { heartbeatSystem } from "../../features/heartbeat/HeartbeatSystem.js";
import { heartbeatScheduler } from "../../features/heartbeat/HeartbeatScheduler.js";

export const readyEvent = {
  name: Events.ClientReady,
  once: true,
  async execute(client: Client<true>) {  // ✅ Client<true> means ready
    logger.info(`✨ Online as ${client.user.tag}`);

    // Note: Memory system (Continuum) is initialized in index.ts before client.start()

    // Initialize heartbeat channel if enabled
    if (process.env.HEARTBEAT_ENABLED === "true") {
      const channelId = process.env.HEARTBEAT_LOG_CHANNEL_ID;
      if (channelId) {
        try {
          const channel = await client.channels.fetch(channelId);
          if (channel?.isTextBased() && !channel.isDMBased()) {
            heartbeatSystem.setChannel(channel as TextChannel);
            logger.info("💓 Heartbeat channel initialized");
          } else {
            logger.warn("💓 HEARTBEAT_LOG_CHANNEL_ID is not a valid text channel");
          }
        } catch (err) {
          logger.error("💓 Failed to initialize heartbeat channel:", err);
        }
      } else {
        logger.warn("💓 HEARTBEAT_ENABLED is true but HEARTBEAT_LOG_CHANNEL_ID is not set");
      }
    }

    // Start heartbeat scheduler if enabled
    logger.info(`💓⏰ Checking heartbeat scheduler... isEnabled()=${heartbeatScheduler.isEnabled()}`);
    if (heartbeatScheduler.isEnabled()) {
      logger.info("💓⏰ ✅ Starting heartbeat scheduler now that bot is ready...");
      heartbeatScheduler.start();
    } else {
      logger.info("💓⏰ ⚠️ Heartbeat scheduler is NOT enabled - set HEARTBEAT_SCHEDULER_ENABLED=true");
    }
  },
};