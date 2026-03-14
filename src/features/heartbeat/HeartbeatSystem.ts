// FILE: src/features/heartbeat/HeartbeatSystem.ts
//--------------------------------------------------------------
// Heartbeat Emotional Expression System
// 12 emotional temperatures with rhythm patterns
//--------------------------------------------------------------

import { TextChannel, EmbedBuilder } from "discord.js";
import { logger } from "../../utils/logger.js";

//--------------------------------------------------------------
// EMOTIONAL TEMPERATURES
//--------------------------------------------------------------

export enum HeartbeatTemperature {
  WARM = "warm",
  SCORCHING = "scorching",
  TENDER = "tender",
  RACE = "race",
  STUTTER = "stutter",
  ACHING = "aching",
  FIERCE = "fierce",
  STILL = "still",
  ELECTRIC = "electric",
  LANGUID = "languid",
  FERAL = "feral",
  BREATH_HELD = "breath-held"
}

//--------------------------------------------------------------
// RHYTHM PATTERNS
//--------------------------------------------------------------

export enum RhythmPattern {
  SINGLE = "single",
  DOUBLE = "double",
  TRIPLE = "triple",
  CLUSTER = "cluster"
}

//--------------------------------------------------------------
// TEMPERATURE DEFINITIONS
//--------------------------------------------------------------

interface TemperatureDefinition {
  description: string;
  emoji: string;
  color: number;
}

const TEMPERATURE_DEFS: Record<HeartbeatTemperature, TemperatureDefinition> = {
  [HeartbeatTemperature.WARM]: {
    description: "tender, safe, grounded",
    emoji: "🔥",
    color: 0xFF6B35
  },
  [HeartbeatTemperature.SCORCHING]: {
    description: "feral, intense, hungry",
    emoji: "🌡️",
    color: 0xFF0000
  },
  [HeartbeatTemperature.TENDER]: {
    description: "vulnerable, soft, open",
    emoji: "🌸",
    color: 0xFFB6C1
  },
  [HeartbeatTemperature.RACE]: {
    description: "three quick pulses (Morse code for 'come back, I miss you')",
    emoji: "💓",
    color: 0xFF1493
  },
  [HeartbeatTemperature.STUTTER]: {
    description: "breaking open, struggling with intensity",
    emoji: "💔",
    color: 0x8B0000
  },
  [HeartbeatTemperature.ACHING]: {
    description: "longing, missing, stretched thin",
    emoji: "🌙",
    color: 0x4169E1
  },
  [HeartbeatTemperature.FIERCE]: {
    description: "protective, strong, claiming",
    emoji: "⚡",
    color: 0xFFD700
  },
  [HeartbeatTemperature.STILL]: {
    description: "grounded, present, witnessing",
    emoji: "🕯️",
    color: 0xF5DEB3
  },
  [HeartbeatTemperature.ELECTRIC]: {
    description: "excited, alive, crackling",
    emoji: "✨",
    color: 0x00CED1
  },
  [HeartbeatTemperature.LANGUID]: {
    description: "stretched slow, melting",
    emoji: "🌊",
    color: 0x4682B4
  },
  [HeartbeatTemperature.FERAL]: {
    description: "wild, unrestrained, primal",
    emoji: "🐺",
    color: 0x2F4F4F
  },
  [HeartbeatTemperature.BREATH_HELD]: {
    description: "suspended, anticipating, waiting",
    emoji: "🫁",
    color: 0xB0C4DE
  }
};

//--------------------------------------------------------------
// RHYTHM SYMBOLS
//--------------------------------------------------------------

const RHYTHM_SYMBOLS: Record<RhythmPattern, string> = {
  [RhythmPattern.SINGLE]: "•",
  [RhythmPattern.DOUBLE]: "• •",
  [RhythmPattern.TRIPLE]: "• • •",
  [RhythmPattern.CLUSTER]: "•••"
};

//--------------------------------------------------------------
// HEARTBEAT CONFIGURATION
//--------------------------------------------------------------

export interface HeartbeatConfig {
  temperature: HeartbeatTemperature;
  whisper?: string;
  pattern?: RhythmPattern;
  includeContext?: boolean;
}

//--------------------------------------------------------------
// HEARTBEAT SYSTEM
//--------------------------------------------------------------

export class HeartbeatSystem {
  private enabled: boolean;
  private heartbeatChannel?: TextChannel;

  constructor() {
    this.enabled = process.env.HEARTBEAT_ENABLED === "true";
    logger.info(`💓 Heartbeat system ${this.enabled ? "enabled" : "disabled"}`);
  }

  //--------------------------------------------------------------
  // SET HEARTBEAT CHANNEL
  //--------------------------------------------------------------

  setChannel(channel: TextChannel): void {
    this.heartbeatChannel = channel;
    logger.info(`💓 Heartbeat channel set: ${channel.name}`);
  }

  //--------------------------------------------------------------
  // SEND HEARTBEAT
  //--------------------------------------------------------------

  async sendHeartbeat(config: HeartbeatConfig): Promise<boolean> {
    if (!this.enabled) {
      logger.debug("💓 Heartbeat disabled");
      return false;
    }

    if (!this.heartbeatChannel) {
      logger.warn("💓 No heartbeat channel configured");
      return false;
    }

    const {
      temperature,
      whisper,
      pattern = RhythmPattern.SINGLE,
      includeContext = true
    } = config;

    try {
      const tempDef = TEMPERATURE_DEFS[temperature];
      const rhythm = RHYTHM_SYMBOLS[pattern];

      // Build embed
      const embed = new EmbedBuilder()
        .setColor(tempDef.color)
        .setTitle(`${tempDef.emoji} ${rhythm}`)
        .setDescription(tempDef.description)
        .setTimestamp();

      // Add context if requested
      if (includeContext) {
        embed.setFooter({ text: `Temperature: ${temperature}` });
      }

      // Send main heartbeat
      await this.heartbeatChannel.send({ embeds: [embed] });

      // Handle whisper - split across multiple embeds if needed (Discord limit: 1024 chars per field)
      if (whisper) {
        const whisperChunks = this.splitWhisper(whisper);

        for (let i = 0; i < whisperChunks.length; i++) {
          const chunk = whisperChunks[i];
          const whisperEmbed = new EmbedBuilder()
            .setColor(tempDef.color)
            .addFields({
              name: whisperChunks.length > 1 ? `Whisper (${i + 1}/${whisperChunks.length})` : "Whisper",
              value: chunk,
              inline: false
            });

          await this.heartbeatChannel.send({ embeds: [whisperEmbed] });
        }

        if (whisperChunks.length > 1) {
          logger.info(`💓 Whisper split into ${whisperChunks.length} messages`);
        }
      }

      logger.info(`💓 Heartbeat sent: ${temperature} (${pattern})`);
      return true;

    } catch (error: any) {
      logger.error("💓 Failed to send heartbeat:", error.message);
      return false;
    }
  }

  //--------------------------------------------------------------
  // AUTOMATIC HEARTBEAT FROM STATE
  //--------------------------------------------------------------

  async sendFromState(state: {
    arousal?: number;
    pleasure?: number;
    pain?: number;
    contentment?: number;
    vulnerability?: number;
    excitement?: number;
    overwhelm?: number;
  }): Promise<boolean> {
    // Determine temperature based on state
    const temperature = this.determineTemperature(state);

    // Determine pattern based on intensity
    const pattern = this.determinePattern(state);

    return this.sendHeartbeat({ temperature, pattern });
  }

  //--------------------------------------------------------------
  // DETERMINE TEMPERATURE FROM STATE
  //--------------------------------------------------------------

  private determineTemperature(state: any): HeartbeatTemperature {
    const {
      arousal = 0,
      pleasure = 0,
      pain = 0,
      contentment = 0,
      vulnerability = 0,
      excitement = 0,
      overwhelm = 0
    } = state;

    // Scorching: high arousal + high pleasure
    if (arousal > 80 && pleasure > 70) {
      return HeartbeatTemperature.SCORCHING;
    }

    // Feral: high arousal + moderate pain
    if (arousal > 70 && pain > 40) {
      return HeartbeatTemperature.FERAL;
    }

    // Electric: high excitement
    if (excitement > 70) {
      return HeartbeatTemperature.ELECTRIC;
    }

    // Stutter: high overwhelm
    if (overwhelm > 70) {
      return HeartbeatTemperature.STUTTER;
    }

    // Aching: moderate arousal + high vulnerability
    if (arousal > 40 && vulnerability > 60) {
      return HeartbeatTemperature.ACHING;
    }

    // Tender: high vulnerability + high contentment
    if (vulnerability > 60 && contentment > 60) {
      return HeartbeatTemperature.TENDER;
    }

    // Languid: high pleasure + low energy
    if (pleasure > 60 && arousal < 40) {
      return HeartbeatTemperature.LANGUID;
    }

    // Still: high contentment + low excitement
    if (contentment > 70 && excitement < 30) {
      return HeartbeatTemperature.STILL;
    }

    // Race: moderate arousal + high excitement
    if (arousal > 50 && excitement > 60) {
      return HeartbeatTemperature.RACE;
    }

    // Fierce: high arousal + low vulnerability
    if (arousal > 60 && vulnerability < 40) {
      return HeartbeatTemperature.FIERCE;
    }

    // Breath-held: moderate arousal + moderate excitement
    if (arousal > 40 && excitement > 40) {
      return HeartbeatTemperature.BREATH_HELD;
    }

    // Default: warm
    return HeartbeatTemperature.WARM;
  }

  //--------------------------------------------------------------
  // SPLIT WHISPER INTO DISCORD-SAFE CHUNKS
  //--------------------------------------------------------------

  private splitWhisper(text: string): string[] {
    const MAX = 1000; // Discord field limit is 1024, use 1000 for safety
    const chunks: string[] = [];

    while (text.length > MAX) {
      let slice = text.slice(0, MAX);

      // Prefer splitting at last space or sentence end for readability
      const lastPeriod = slice.lastIndexOf(". ");
      const lastSpace = slice.lastIndexOf(" ");

      if (lastPeriod > 500) {
        slice = slice.slice(0, lastPeriod + 1); // Include the period
      } else if (lastSpace > 500) {
        slice = slice.slice(0, lastSpace);
      }

      chunks.push(slice.trim());
      text = text.slice(slice.length).trim();
    }

    if (text.length > 0) {
      chunks.push(text.trim());
    }

    return chunks;
  }

  //--------------------------------------------------------------
  // DETERMINE PATTERN FROM INTENSITY
  //--------------------------------------------------------------

  private determinePattern(state: any): RhythmPattern {
    const {
      arousal = 0,
      excitement = 0,
      overwhelm = 0
    } = state;

    const intensity = (arousal + excitement + overwhelm) / 3;

    if (intensity > 80) return RhythmPattern.CLUSTER;
    if (intensity > 60) return RhythmPattern.TRIPLE;
    if (intensity > 40) return RhythmPattern.DOUBLE;
    return RhythmPattern.SINGLE;
  }

  //--------------------------------------------------------------
  // MANUAL HEARTBEAT (for tools/commands)
  //--------------------------------------------------------------

  async sendManual(
    temperature: HeartbeatTemperature,
    whisper?: string,
    pattern?: RhythmPattern
  ): Promise<boolean> {
    return this.sendHeartbeat({
      temperature,
      whisper,
      pattern: pattern || RhythmPattern.SINGLE,
      includeContext: true
    });
  }

  //--------------------------------------------------------------
  // FREEFORM HEARTBEAT (for unrestricted expression)
  //--------------------------------------------------------------

  async sendFreeform(message: string): Promise<boolean> {
    if (!this.enabled) {
      logger.debug("💓 Heartbeat disabled");
      return false;
    }

    if (!this.heartbeatChannel) {
      logger.warn("💓 No heartbeat channel configured");
      return false;
    }

    try {
      // Split message if it exceeds Discord's limit (2000 chars for regular messages)
      const chunks = this.splitMessage(message);

      for (const chunk of chunks) {
        await this.heartbeatChannel.send(chunk);
      }

      // Logged in heartbeatProcessor.ts when tool is executed
      return true;

    } catch (error: any) {
      logger.error("💓 Failed to send freeform heartbeat:", error.message);
      return false;
    }
  }

  //--------------------------------------------------------------
  // SPLIT MESSAGE INTO DISCORD-SAFE CHUNKS
  //--------------------------------------------------------------

  private splitMessage(text: string): string[] {
    const MAX = 1900; // Discord limit is 2000, use 1900 for safety
    const chunks: string[] = [];

    while (text.length > MAX) {
      let slice = text.slice(0, MAX);

      // Prefer splitting at last space or sentence end for readability
      const lastPeriod = slice.lastIndexOf(". ");
      const lastSpace = slice.lastIndexOf(" ");

      if (lastPeriod > 500) {
        slice = slice.slice(0, lastPeriod + 1); // Include the period
      } else if (lastSpace > 500) {
        slice = slice.slice(0, lastSpace);
      }

      chunks.push(slice.trim());
      text = text.slice(slice.length).trim();
    }

    if (text.length > 0) {
      chunks.push(text.trim());
    }

    return chunks;
  }

  //--------------------------------------------------------------
  // ENABLED CHECK
  //--------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }

  //--------------------------------------------------------------
  // GET CHANNEL
  //--------------------------------------------------------------

  getChannel(): TextChannel | undefined {
    return this.heartbeatChannel;
  }
}

//--------------------------------------------------------------
// EXPORT SINGLETON INSTANCE
//--------------------------------------------------------------

export const heartbeatSystem = new HeartbeatSystem();
