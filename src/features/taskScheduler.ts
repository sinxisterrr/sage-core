// FILE: src/features/taskScheduler.ts
//--------------------------------------------------------------
// Task Scheduling System
// Recurring tasks and reminders
//--------------------------------------------------------------

import cron from "node-cron";
import { Client, TextChannel } from "discord.js";
import { logger } from "../utils/logger.js";
import { query } from "../db/db.js";

const BOT_ID = process.env.BOT_ID || "DEFAULT";
const TIMEZONE = process.env.TIMEZONE || "America/Denver";

interface ScheduledTask {
  id: number;
  taskName: string;
  taskType: "hourly" | "daily" | "weekly" | "monthly" | "once";
  scheduleTime?: string;
  scheduleDay?: string;
  channelId: string;
  userId?: string;
  messageContent: string;
  enabled: boolean;
  nextRun?: Date;
}

let activeCrons: Map<number, cron.ScheduledTask> = new Map();
let discordClient: Client;

//--------------------------------------------------------------
// Initialize task scheduler
//--------------------------------------------------------------

export async function initTaskScheduler(client: Client) {
  discordClient = client;
  logger.info("⏰ Task scheduler initialized");
  await loadScheduledTasks();
}

//--------------------------------------------------------------
// Load all scheduled tasks from database
//--------------------------------------------------------------

async function loadScheduledTasks() {
  try {
    const tasks = await query<ScheduledTask>(
      `SELECT * FROM task_schedule
       WHERE bot_id = $1 AND enabled = true
       ORDER BY next_run ASC`,
      [BOT_ID]
    );

    for (const task of tasks) {
      await scheduleCronTask(task);
    }

    logger.info(`⏰ Loaded ${tasks.length} scheduled tasks`);
  } catch (error) {
    logger.error("Error loading scheduled tasks:", error);
  }
}

//--------------------------------------------------------------
// Schedule a cron task
//--------------------------------------------------------------

async function scheduleCronTask(task: ScheduledTask) {
  const cronExpression = getCronExpression(task);
  if (!cronExpression) {
    logger.error(`Invalid cron expression for task: ${task.taskName}`);
    return;
  }

  try {
    const cronTask = cron.schedule(
      cronExpression,
      async () => {
        await executeTask(task);
      },
      {
        timezone: TIMEZONE,
      }
    );

    activeCrons.set(task.id, cronTask);
    logger.info(`⏰ Scheduled task: ${task.taskName} (${cronExpression})`);
  } catch (error) {
    logger.error(`Error scheduling task ${task.taskName}:`, error);
  }
}

//--------------------------------------------------------------
// Get cron expression for task type
//--------------------------------------------------------------

function getCronExpression(task: ScheduledTask): string | null {
  switch (task.taskType) {
    case "hourly":
      return "0 * * * *"; // Every hour

    case "daily":
      if (task.scheduleTime) {
        const [hour, minute] = task.scheduleTime.split(":");
        return `${minute} ${hour} * * *`;
      }
      return "0 9 * * *"; // Default: 9 AM

    case "weekly":
      if (task.scheduleTime && task.scheduleDay) {
        const [hour, minute] = task.scheduleTime.split(":");
        const dayNumber = getDayNumber(task.scheduleDay);
        return `${minute} ${hour} * * ${dayNumber}`;
      }
      return "0 9 * * 1"; // Default: Monday 9 AM

    case "monthly":
      if (task.scheduleTime) {
        const [hour, minute] = task.scheduleTime.split(":");
        return `${minute} ${hour} 1 * *`; // First day of month
      }
      return "0 9 1 * *"; // Default: 1st of month, 9 AM

    case "once":
      return null; // One-time tasks handled differently

    default:
      return null;
  }
}

//--------------------------------------------------------------
// Get day number for cron (0 = Sunday, 6 = Saturday)
//--------------------------------------------------------------

function getDayNumber(dayName: string): number {
  const days: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  return days[dayName.toLowerCase()] || 1;
}

//--------------------------------------------------------------
// Execute a task
//--------------------------------------------------------------

async function executeTask(task: ScheduledTask) {
  try {
    const channel = await discordClient.channels.fetch(task.channelId);
    if (!channel || !channel.isTextBased()) {
      logger.error(`Invalid channel for task: ${task.taskName}`);
      return;
    }

    await (channel as TextChannel).send(task.messageContent);

    // Update last_run and next_run
    await query(
      `UPDATE task_schedule
       SET last_run = NOW(),
           next_run = NOW() + INTERVAL '1 hour'
       WHERE id = $1`,
      [task.id]
    );

    logger.info(`✅ Executed task: ${task.taskName}`);
  } catch (error) {
    logger.error(`Error executing task ${task.taskName}:`, error);
  }
}

//--------------------------------------------------------------
// Create new scheduled task
//--------------------------------------------------------------

export async function createScheduledTask(
  taskName: string,
  taskType: "hourly" | "daily" | "weekly" | "monthly",
  channelId: string,
  messageContent: string,
  scheduleTime?: string,
  scheduleDay?: string,
  userId?: string
): Promise<number | null> {
  try {
    const result = await query<{ id: number }>(
      `INSERT INTO task_schedule
       (bot_id, task_name, task_type, schedule_time, schedule_day, channel_id, user_id, message_content, enabled, next_run)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW() + INTERVAL '1 minute')
       RETURNING id`,
      [
        BOT_ID,
        taskName,
        taskType,
        scheduleTime || null,
        scheduleDay || null,
        channelId,
        userId || null,
        messageContent,
      ]
    );

    const taskId = result[0].id;

    // Schedule the cron job
    const task: ScheduledTask = {
      id: taskId,
      taskName,
      taskType,
      scheduleTime,
      scheduleDay,
      channelId,
      userId,
      messageContent,
      enabled: true,
    };

    await scheduleCronTask(task);

    logger.info(`✅ Created scheduled task: ${taskName}`);
    return taskId;
  } catch (error) {
    logger.error("Error creating scheduled task:", error);
    return null;
  }
}

//--------------------------------------------------------------
// Cancel a scheduled task
//--------------------------------------------------------------

export async function cancelScheduledTask(taskId: number): Promise<boolean> {
  try {
    // Stop cron job
    const cronTask = activeCrons.get(taskId);
    if (cronTask) {
      cronTask.stop();
      activeCrons.delete(taskId);
    }

    // Disable in database
    await query(
      `UPDATE task_schedule SET enabled = false WHERE id = $1`,
      [taskId]
    );

    logger.info(`⏰ Cancelled task ID: ${taskId}`);
    return true;
  } catch (error) {
    logger.error("Error cancelling task:", error);
    return false;
  }
}

//--------------------------------------------------------------
// List all active tasks
//--------------------------------------------------------------

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  try {
    const tasks = await query<ScheduledTask>(
      `SELECT * FROM task_schedule
       WHERE bot_id = $1 AND enabled = true
       ORDER BY next_run ASC`,
      [BOT_ID]
    );

    return tasks;
  } catch (error) {
    logger.error("Error listing tasks:", error);
    return [];
  }
}
