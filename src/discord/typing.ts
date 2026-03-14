//--------------------------------------------------------------
// Mood-adaptive typing pulse
//--------------------------------------------------------------

import {
  GuildTextBasedChannel,
  DMChannel,
  PartialDMChannel,
} from "discord.js";

import { internalState } from "../core/brain.js";

type SendableChannel =
  | GuildTextBasedChannel
  | DMChannel
  | PartialDMChannel;

const BASE_SPEED = 18;

export function estimateTypingTime(text: string): number {
  let speed = BASE_SPEED;

  if (internalState.energy > 0.6) speed *= 0.75;
  if (internalState.emotionalWeight > 0.6) speed *= 1.4;
  if (internalState.attunement > 0.8) speed *= 1.2;

  return Math.min(Math.max(text.length * speed, 1000), 8000);
}

export async function showTyping(
  channel: SendableChannel,
  durationMs: number
) {
  if (!("sendTyping" in channel)) return;

  const interval = 8000;

  channel.sendTyping();

  const pulses = Math.ceil(durationMs / interval);

  for (let i = 1; i < pulses; i++) {
    await new Promise(res => setTimeout(res, interval));
    channel.sendTyping();
  }
}
