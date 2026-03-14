// FILE: src/features/dailyStats/DailyStatsScheduler.ts
//--------------------------------------------------------------
// Daily Stats Scheduler
// Posts daily system/memory statistics at midnight
// Uses TIMEZONE env var for consistency with other features
//--------------------------------------------------------------

import { logger } from "../../utils/logger.js";
import { getMemoryStats, getMemoryStatsRP, MemoryStats } from "../../memory/memoryManager.js";
import { getPeopleMapStats, PeopleMapStats } from "../../memory/peopleMap.js";

//--------------------------------------------------------------
// DAILY STATS SCHEDULER
//--------------------------------------------------------------

export class DailyStatsScheduler {
  private enabled: boolean;
  private channelId: string | null;
  private timezone: string;
  private timer: NodeJS.Timeout | null = null;
  private discordClient: any = null;

  constructor() {
    this.channelId = process.env.DAILY_STATS_CHANNEL_ID || null;
    this.timezone = process.env.TIMEZONE || "America/Denver";
    this.enabled = !!this.channelId;

    logger.info(`📊 DailyStatsScheduler constructor - DAILY_STATS_CHANNEL_ID=${this.channelId ? 'set' : 'not set'}`);
  }

  //--------------------------------------------------------------
  // SET DISCORD CLIENT (called after client is ready)
  //--------------------------------------------------------------

  setClient(client: any): void {
    this.discordClient = client;
    logger.info("📊 DailyStatsScheduler received Discord client");
  }

  //--------------------------------------------------------------
  // START SCHEDULER
  //--------------------------------------------------------------

  start(): void {
    logger.info(`📊 start() called - enabled=${this.enabled}`);

    if (!this.enabled) {
      logger.info("📊 Daily stats scheduler disabled - DAILY_STATS_CHANNEL_ID not set");
      return;
    }

    if (!this.discordClient) {
      logger.warn("📊 Daily stats scheduler cannot start - Discord client not set");
      return;
    }

    logger.info("📊 ✅ Starting daily stats scheduler...");
    logger.info(`📊 Timezone: ${this.timezone}`);
    logger.info(`📊 Channel: ${this.channelId}`);
    this.scheduleNextMidnight();
  }

  //--------------------------------------------------------------
  // CALCULATE MS UNTIL NEXT MIDNIGHT
  //--------------------------------------------------------------

  private getMsUntilMidnight(): number {
    const now = new Date();

    // Get current time in the configured timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';

    const currentHour = parseInt(getPart('hour'));
    const currentMinute = parseInt(getPart('minute'));
    const currentSecond = parseInt(getPart('second'));

    // Calculate seconds until midnight
    const secondsUntilMidnight =
      (24 - currentHour - 1) * 3600 +
      (60 - currentMinute - 1) * 60 +
      (60 - currentSecond);

    return secondsUntilMidnight * 1000;
  }

  //--------------------------------------------------------------
  // SCHEDULE NEXT MIDNIGHT POST
  //--------------------------------------------------------------

  private scheduleNextMidnight(): void {
    const msUntilMidnight = this.getMsUntilMidnight();
    const hoursUntil = (msUntilMidnight / 3600000).toFixed(1);

    logger.info(`📊 Next daily stats post in ${hoursUntil} hours (at midnight ${this.timezone})`);

    this.timer = setTimeout(async () => {
      await this.postDailyStats();

      // Schedule next midnight (add 1 minute buffer to ensure we're past midnight)
      setTimeout(() => this.scheduleNextMidnight(), 60000);
    }, msUntilMidnight);
  }

  //--------------------------------------------------------------
  // POST DAILY STATS
  //--------------------------------------------------------------

  private async postDailyStats(): Promise<void> {
    if (!this.discordClient || !this.channelId) {
      logger.warn("📊 Cannot post daily stats - client or channel not available");
      return;
    }

    try {
      const channel = await this.discordClient.channels.fetch(this.channelId);
      if (!channel || !channel.isTextBased()) {
        logger.error(`📊 Channel ${this.channelId} not found or not text-based`);
        return;
      }

      // Gather all stats
      const regularStats = await getMemoryStats();
      const rpStats = await getMemoryStatsRP();
      const peopleStats = await getPeopleMapStats();

      // Format the stats message
      const statsMessage = this.formatStatsMessage(regularStats, rpStats, peopleStats);

      await channel.send(statsMessage);
      logger.info("📊 ✅ Daily stats posted successfully");

    } catch (error: any) {
      logger.error(`📊 Failed to post daily stats: ${error.message}`);
    }
  }

  //--------------------------------------------------------------
  // FORMAT STATS MESSAGE
  //--------------------------------------------------------------

  private formatStatsMessage(
    regularStats: MemoryStats,
    rpStats: MemoryStats,
    peopleStats: PeopleMapStats
  ): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
      timeZone: this.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Storage Stats (combine both tables)
    const totalStorageMB = regularStats.storageUsedMB + rpStats.storageUsedMB;
    const storagePercent = (totalStorageMB / regularStats.storageLimitMB) * 100;
    const needsCleanup = storagePercent >= 90;

    // Build the tree structure
    let tree = `📊 Daily System Report — ${dateStr}\n`;
    tree += `├── 💾 Storage\n`;
    tree += `│   ├── Total: ${totalStorageMB.toFixed(1)} MB / ${regularStats.storageLimitMB} MB (${storagePercent.toFixed(1)}%)\n`;
    tree += `│   ├── Regular: ${regularStats.storageUsedMB.toFixed(1)} MB\n`;
    tree += `│   ├── RP: ${rpStats.storageUsedMB.toFixed(1)} MB\n`;
    tree += `│   └── Status: ${needsCleanup ? '⚠️ Cleanup needed' : '✅ Healthy'}\n`;
    tree += `│\n`;
    tree += `├── 🧠 Memory Distribution\n`;
    tree += `│   ├── Regular Memories (${regularStats.totalMemories} total)\n`;
    tree += `│   │   ├── Active: ${regularStats.byState.active}\n`;
    tree += `│   │   ├── Favorites: ${regularStats.byState.favorite}\n`;
    tree += `│   │   ├── Faded: ${regularStats.byState.faded}\n`;
    tree += `│   │   └── Forgotten: ${regularStats.byState.forgotten}\n`;
    tree += `│   │\n`;
    tree += `│   └── RP Memories (${rpStats.totalMemories} total)\n`;
    tree += `│       ├── Active: ${rpStats.byState.active}\n`;
    tree += `│       ├── Favorites: ${rpStats.byState.favorite}\n`;
    tree += `│       ├── Faded: ${rpStats.byState.faded}\n`;
    tree += `│       └── Forgotten: ${rpStats.byState.forgotten}\n`;
    tree += `│\n`;
    tree += `└── 👥 People Map\n`;
    tree += `    ├── Humans tracked: ${peopleStats.humanCount}\n`;
    tree += `    ├── AIs tracked: ${peopleStats.aiCount}\n`;
    tree += `    └── Total connections: ${peopleStats.totalConnections}\n`;

    // Category breakdown
    if (Object.keys(peopleStats.byCategory).length > 0) {
      tree += `        ├── Categories:\n`;
      const categories = Object.entries(peopleStats.byCategory).filter(([_, count]) => count > 0);
      categories.forEach(([category, count], index) => {
        const isLast = index === categories.length - 1 && !peopleStats.recentInteraction;
        tree += `        ${isLast ? '└' : '├'}── ${category}: ${count}\n`;
      });
    }

    if (peopleStats.recentInteraction) {
      tree += `        └── Most recent: ${peopleStats.recentInteraction}\n`;
    }

    // Wrap in code block for clean formatting
    const message = `\`\`\`\n${tree}\`\`\``;

    return message;
  }

  //--------------------------------------------------------------
  // STOP SCHEDULER
  //--------------------------------------------------------------

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info("📊 Daily stats scheduler stopped");
  }

  //--------------------------------------------------------------
  // MANUAL POST (for testing)
  //--------------------------------------------------------------

  async postNow(): Promise<void> {
    logger.info("📊 Manual daily stats post triggered");
    await this.postDailyStats();
  }

  //--------------------------------------------------------------
  // STATUS CHECK
  //--------------------------------------------------------------

  isEnabled(): boolean {
    return this.enabled;
  }

  getChannelId(): string | null {
    return this.channelId;
  }
}

//--------------------------------------------------------------
// EXPORT SINGLETON INSTANCE
//--------------------------------------------------------------

export const dailyStatsScheduler = new DailyStatsScheduler();
