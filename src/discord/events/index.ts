// FILE: src/discord/events/index.ts
//--------------------------------------------------------------
import { Client, ClientEvents } from "discord.js";
import { logger } from "../../utils/logger.js";
import { readyEvent } from "./ready.js";
import { messageCreateEvent } from "./messageCreate.js";

type EventHandler = {
  name: keyof ClientEvents | string;
  once: boolean;
  execute: (...args: any[]) => void | Promise<void>;
};

export function registerEvents(client: Client) {
  const events: EventHandler[] = [readyEvent, messageCreateEvent];

  console.log("🔍 Loading events:");
  for (const evt of events) {
    console.log("  •", evt.name);
  }

  for (const evt of events) {
    if (evt.once) {
      client.once(evt.name, (...args) => evt.execute(...args));
    } else {
      client.on(evt.name, (...args) => evt.execute(...args));
    }
  }

  logger.info(`📡 Registered ${events.length} Discord event(s).`);
}
