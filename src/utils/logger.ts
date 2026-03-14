// FILE: src/utils/logger.ts
//--------------------------------------------------------------
// Logger — quiet when it should be, loud when it matters.
//--------------------------------------------------------------

function ts() {
  return new Date().toISOString();
}

function tag(level: string) {
  return `[${ts()}][${process.env.AI_NAME || 'Bot'}][${level}]`;
}

export const logger = {
  info: (...args: any[]) => console.log(`ℹ️ ${tag("INFO")}`, ...args),
  warn: (...args: any[]) => console.warn(`⚠️ ${tag("WARN")}`, ...args),
  error: (...args: any[]) => console.error(`❌ ${tag("ERROR")}`, ...args),

  debug: (...args: any[]) => {
    if (process.env.DEBUG === "true") {
      console.log(`🐛 ${tag("DEBUG")}`, ...args);
    }
  },
};
