// FILE: src/features/heartbeat/HeartbeatScheduler.ts
//--------------------------------------------------------------
// Heartbeat Timing Scheduler
// Recursive timer with time-based intervals and probabilities
// Based on Discord-Bot-enhanced-Public heartbeat system
//--------------------------------------------------------------

import { logger } from "../../utils/logger.js";


//--------------------------------------------------------------
// TIME-BASED HEARTBEAT CONFIGURATION
//--------------------------------------------------------------

interface HeartbeatTimeConfig {
  hourStart: number;         // 0-23
  hourEnd: number;           // 0-23
  intervalMinutes: number;   // Base interval for this time period
  description: string;
}

//--------------------------------------------------------------
// DEFAULT SCHEDULE (7 time periods throughout the day)
//--------------------------------------------------------------

const DEFAULT_SCHEDULE: HeartbeatTimeConfig[] = [
  {
    hourStart: 7,
    hourEnd: 9,
    intervalMinutes: 30,
    description: "07:00-09:00 Morning wake-up"
  },
  {
    hourStart: 9,
    hourEnd: 12,
    intervalMinutes: 45,
    description: "09:00-12:00 Quiet morning"
  },
  {
    hourStart: 12,
    hourEnd: 14,
    intervalMinutes: 15,
    description: "12:00-14:00 Lunch time"
  },
  {
    hourStart: 14,
    hourEnd: 17,
    intervalMinutes: 30,
    description: "14:00-17:00 Afternoon active"
  },
  {
    hourStart: 18,
    hourEnd: 22,
    intervalMinutes: 20,
    description: "18:00-22:00 Evening prime time"
  },
  {
    hourStart: 22,
    hourEnd: 1,
    intervalMinutes: 45,
    description: "22:00-01:00 Night wind down"
  },
  {
    hourStart: 1,
    hourEnd: 7,
    intervalMinutes: 90,
    description: "01:00-07:00 Deep sleep"
  }
];

//--------------------------------------------------------------
// HEARTBEAT SCHEDULER
//--------------------------------------------------------------

export class HeartbeatScheduler {
  private enabled: boolean;
  private schedule: HeartbeatTimeConfig[];
  private timezone: string;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.enabled = process.env.HEARTBEAT_SCHEDULER_ENABLED === "true";
    this.timezone = process.env.TIMEZONE || "America/Denver";
    this.schedule = DEFAULT_SCHEDULE;

    logger.info(`💓⏰ HeartbeatScheduler constructor - HEARTBEAT_SCHEDULER_ENABLED=${process.env.HEARTBEAT_SCHEDULER_ENABLED}`);

    // Don't auto-start in constructor - wait for explicit start() call
    // This ensures bot is ready before heartbeats begin
  }

  //--------------------------------------------------------------
  // START RECURSIVE TIMER
  //--------------------------------------------------------------

  start(): void {
    logger.info(`💓⏰ start() called - enabled=${this.enabled}`);

    if (!this.enabled) {
      logger.info("💓⏰ Heartbeat scheduler disabled - HEARTBEAT_SCHEDULER_ENABLED is not 'true'");
      return;
    }

    logger.info("💓⏰ ✅ Starting recursive heartbeat timer...");
    logger.info(`💓⏰ Timezone: ${this.timezone}`);
    this.startRecursiveTimer();
  }

  //--------------------------------------------------------------
  // RECURSIVE TIMER LOOP
  //--------------------------------------------------------------

  private startRecursiveTimer(): void {
    // Universal random delay: 15-90 minutes
    const minDelayMs = 15 * 60 * 1000;  // 15 minutes
    const maxDelayMs = 90 * 60 * 1000;  // 90 minutes
    const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs));

    // Get current time config for context/description only (not for timing)
    const now = new Date();
    const currentHour = parseInt(now.toLocaleString('en-US', {
      timeZone: this.timezone,
      hour: 'numeric',
      hour12: false
    }));

    const config = this.schedule.find(c =>
      this.isInTimeRange(currentHour, c.hourStart, c.hourEnd)
    );

    const description = config ? config.description : `${currentHour}:00 (no config)`;

    // Calculate exact time for next heartbeat using configured timezone (24-hour format)
    const nextHeartbeat = new Date(Date.now() + delayMs);
    const timeString = nextHeartbeat.toLocaleTimeString('en-US', {
      timeZone: this.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    logger.info(`💓⏰ Next heartbeat in ${(delayMs / 60000).toFixed(1)} min at ${timeString} (${description})`);

    // Schedule next check
    this.timer = setTimeout(async () => {
      await this.checkAndMaybeSendHeartbeat(config || {
        hourStart: currentHour,
        hourEnd: currentHour + 1,
        intervalMinutes: 0, // Not used anymore
        description: description
      });

      // Recursively schedule next timer with 1 second delay
      setTimeout(() => this.startRecursiveTimer(), 1000);
    }, delayMs);
  }

  //--------------------------------------------------------------
  // SEND HEARTBEAT (always fires, AI decides what to do)
  //--------------------------------------------------------------

  private async checkAndMaybeSendHeartbeat(config: HeartbeatTimeConfig): Promise<void> {
    // Check if heartbeats are actually enabled (not just the scheduler)
    if (process.env.HEARTBEAT_ENABLED !== "true") {
      logger.warn(`💓⏰ Skipping heartbeat - HEARTBEAT_ENABLED is not 'true'`);
      return;
    }

    logger.info(`💓⏰ Triggering heartbeat: ${config.description}`);

    try {
      const { processHeartbeatMoment } = await import("./heartbeatProcessor.js");
      await processHeartbeatMoment({
        timeConfig: config,
        currentTime: new Date()
      });
    } catch (error: any) {
      logger.error(`💓⏰ Heartbeat error: ${error.message}`);
      logger.error(error.stack);
    }
  }

  //--------------------------------------------------------------
  // CHECK IF HOUR IS IN RANGE
  //--------------------------------------------------------------

  private isInTimeRange(hour: number, start: number, end: number): boolean {
    if (start <= end) {
      return hour >= start && hour < end;
    } else {
      // Handle ranges that cross midnight (e.g., 22-2)
      return hour >= start || hour < end;
    }
  }

  //--------------------------------------------------------------
  // UPDATE SCHEDULE
  //--------------------------------------------------------------

  setSchedule(schedule: HeartbeatTimeConfig[]): void {
    this.schedule = schedule;
    logger.info("💓⏰ Heartbeat schedule updated");
  }

  //--------------------------------------------------------------
  // STOP SCHEDULER
  //--------------------------------------------------------------

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("💓⏰ Heartbeat scheduler stopped");
  }

  //--------------------------------------------------------------
  // ENABLED CHECK
  //--------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }

  //--------------------------------------------------------------
  // GET CURRENT SCHEDULE
  //--------------------------------------------------------------

  getSchedule(): HeartbeatTimeConfig[] {
    return this.schedule;
  }
}

//--------------------------------------------------------------
// EXPORT SINGLETON INSTANCE
//--------------------------------------------------------------

export const heartbeatScheduler = new HeartbeatScheduler();
