// FILE: src/features/reflection/ReflectionScheduler.ts
//--------------------------------------------------------------
// Reflection Time Scheduler
// Triggers at midnight (00:00) and noon (12:00) for introspection
// AI chooses whether to reflect, post, save privately, or skip
//--------------------------------------------------------------

import { logger } from "../../utils/logger.js";
import { processReflectionMoment } from "./reflectionProcessor.js";

//--------------------------------------------------------------
// REFLECTION SCHEDULER
//--------------------------------------------------------------

export class ReflectionScheduler {
  private enabled: boolean;
  private channelId: string | null;
  private timezone: string;
  private timer: NodeJS.Timeout | null = null;
  private discordClient: any = null;

  constructor() {
    this.channelId = process.env.REFLECTION_CHANNEL_ID || null;
    this.timezone = process.env.TIMEZONE || "America/Denver";
    this.enabled = process.env.REFLECTION_ENABLED === "true";

    logger.info(`🌙 ReflectionScheduler constructor - REFLECTION_ENABLED=${process.env.REFLECTION_ENABLED}`);
  }

  //--------------------------------------------------------------
  // SET DISCORD CLIENT
  //--------------------------------------------------------------

  setClient(client: any): void {
    this.discordClient = client;
    logger.info("🌙 ReflectionScheduler received Discord client");
  }

  //--------------------------------------------------------------
  // START SCHEDULER
  //--------------------------------------------------------------

  start(): void {
    logger.info(`🌙 start() called - enabled=${this.enabled}`);

    if (!this.enabled) {
      logger.info("🌙 Reflection scheduler disabled - REFLECTION_ENABLED is not 'true'");
      return;
    }

    if (!this.discordClient) {
      logger.warn("🌙 Reflection scheduler cannot start - Discord client not set");
      return;
    }

    logger.info("🌙 ✅ Starting reflection scheduler...");
    logger.info(`🌙 Timezone: ${this.timezone}`);
    logger.info(`🌙 Channel: ${this.channelId || '(AI chooses each time)'}`);
    this.scheduleNextReflection();
  }

  //--------------------------------------------------------------
  // GET CURRENT HOUR IN TIMEZONE
  //--------------------------------------------------------------

  private getCurrentHour(): number {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      hour: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    return parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  }

  //--------------------------------------------------------------
  // CALCULATE MS UNTIL NEXT REFLECTION TIME (00:00 or 12:00)
  //--------------------------------------------------------------

  private getMsUntilNextReflection(): { ms: number; targetHour: number } {
    const now = new Date();

    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const currentHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    const currentMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
    const currentSecond = parseInt(parts.find(p => p.type === 'second')?.value || '0');

    // Calculate seconds to next reflection time
    let targetHour: number;
    let hoursUntil: number;

    if (currentHour < 12) {
      // Before noon - next reflection at 12:00
      targetHour = 12;
      hoursUntil = 12 - currentHour - 1;
    } else {
      // After noon - next reflection at midnight (00:00)
      targetHour = 0;
      hoursUntil = 24 - currentHour - 1;
    }

    const secondsUntil =
      hoursUntil * 3600 +
      (60 - currentMinute - 1) * 60 +
      (60 - currentSecond);

    return { ms: secondsUntil * 1000, targetHour };
  }

  //--------------------------------------------------------------
  // SCHEDULE NEXT REFLECTION
  //--------------------------------------------------------------

  private scheduleNextReflection(): void {
    const { ms, targetHour } = this.getMsUntilNextReflection();
    const hoursUntil = (ms / 3600000).toFixed(1);
    const timeLabel = targetHour === 0 ? "midnight" : "noon";

    logger.info(`🌙 Next reflection in ${hoursUntil} hours (at ${timeLabel} ${this.timezone})`);

    this.timer = setTimeout(async () => {
      await this.triggerReflection(targetHour);

      // Schedule next (add 1 minute buffer)
      setTimeout(() => this.scheduleNextReflection(), 60000);
    }, ms);
  }

  //--------------------------------------------------------------
  // TRIGGER REFLECTION
  //--------------------------------------------------------------

  private async triggerReflection(hour: number): Promise<void> {
    const timeLabel = hour === 0 ? "midnight" : "noon";
    logger.info(`🌙 Reflection time triggered (${timeLabel})`);

    if (!this.discordClient) {
      logger.warn("🌙 Cannot process reflection - Discord client not available");
      return;
    }

    try {
      const result = await processReflectionMoment(
        this.discordClient,
        this.channelId,
        hour
      );

      if (result.skipped) {
        logger.info(`🌙 Chose to skip reflection (${timeLabel})`);
      } else if (result.posted) {
        logger.info(`🌙 Reflection posted to channel (${timeLabel})`);
      } else if (result.savedPrivately) {
        logger.info(`🌙 Reflection saved privately (${timeLabel})`);
      }

    } catch (error: any) {
      logger.error(`🌙 Reflection processing failed: ${error.message}`);
    }
  }

  //--------------------------------------------------------------
  // STOP SCHEDULER
  //--------------------------------------------------------------

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("🌙 Reflection scheduler stopped");
  }

  //--------------------------------------------------------------
  // MANUAL TRIGGER (for testing)
  //--------------------------------------------------------------

  async triggerNow(): Promise<void> {
    logger.info("🌙 Manual reflection triggered");
    const currentHour = this.getCurrentHour();
    await this.triggerReflection(currentHour);
  }

  //--------------------------------------------------------------
  // STATUS
  //--------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }

  getChannelId(): string | null {
    return this.channelId;
  }
}

//--------------------------------------------------------------
// EXPORT SINGLETON
//--------------------------------------------------------------

export const reflectionScheduler = new ReflectionScheduler();
