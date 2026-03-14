//--------------------------------------------------------------
// FILE: src/utils/time.ts
// Timezone-aware date/time utilities
//--------------------------------------------------------------

/**
 * Get current date/time formatted for the configured timezone
 * Returns a human-readable string with day, date, and time
 */
export function getCurrentDateTime(): string {
  const timezone = process.env.TIMEZONE || 'America/Denver';

  const now = new Date();

  // Format: "Monday, January 5, 2026 at 15:45"
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const date = dateFormatter.format(now);
  const time = timeFormatter.format(now);

  return `${date} at ${time}`;
}

/**
 * Get current date/time in a compact format
 * Returns: "Mon Jan 5, 15:45"
 */
export function getCompactDateTime(): string {
  const timezone = process.env.TIMEZONE || 'America/Denver';

  const now = new Date();

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(now);
}

/**
 * Get timezone name for display
 */
export function getTimezoneName(): string {
  const timezone = process.env.TIMEZONE || 'America/Denver';
  
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  });
  
  const parts = formatter.formatToParts(now);
  const tzPart = parts.find(part => part.type === 'timeZoneName');
  
  return tzPart?.value || timezone;
}
