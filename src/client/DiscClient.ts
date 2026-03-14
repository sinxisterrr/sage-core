// src/client/Client.ts
//--------------------------------------------------------------
import { Client, GatewayIntentBits, Partials } from "discord.js";
import { loadEnv } from "../utils/env.js";
import { logger } from "../utils/logger.js";
import { registerEvents } from "../discord/events/index.js";

export class DiscClient extends Client {
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
  }

  async start() {
    const { DISCORD_BOT_TOKEN } = loadEnv();

    // Register event handlers before login
    registerEvents(this);

    // Wait for ready event before resolving
    const readyPromise = new Promise<void>((resolve) => {
      this.once("ready", () => {
        logger.info(`✨ Connected as ${this.user?.tag}`);
        resolve();
      });
    });

    try {
      await this.login(DISCORD_BOT_TOKEN);
      await readyPromise; // Wait until client is fully ready
    } catch (err) {
      logger.error("❌ Login failed:", err);
      throw err;
    }
  }
}