// FILE: src/utils/file.ts
//--------------------------------------------------------------
//  Low-level file helpers
//  Safe JSON read/write with atomic writes
//--------------------------------------------------------------

import fs from "fs";
import path from "path";

// Ensure directory exists before writing
function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

//--------------------------------------------------------------
//  WRITE JSON (atomic)
//--------------------------------------------------------------
export async function writeJSON(filePath: string, data: any) {
  return new Promise<void>((resolve, reject) => {
    try {
      ensureDir(filePath);

      const temp = filePath + ".tmp";
      const json = JSON.stringify(data, null, 2);

      fs.writeFile(temp, json, "utf8", (err) => {
        if (err) return reject(err);

        // Atomic replace
        fs.rename(temp, filePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

//--------------------------------------------------------------
//  READ JSON
//--------------------------------------------------------------
export async function readJSON<T>(filePath: string, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    try {
      if (!fs.existsSync(filePath)) {
        return resolve(fallback);
      }

      fs.readFile(filePath, "utf8", (err, data) => {
        if (err) return resolve(fallback);

        try {
          const parsed = JSON.parse(data);
          resolve(parsed as T);
        } catch {
          resolve(fallback);
        }
      });
    } catch {
      resolve(fallback);
    }
  });
}
