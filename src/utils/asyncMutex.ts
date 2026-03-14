//--------------------------------------------------------------
// FILE: src/utils/asyncMutex.ts
// Async mutex for thread-safe operations in Node.js
// Prevents race conditions in concurrent async operations
//--------------------------------------------------------------

/**
 * Simple async mutex for protecting critical sections
 * Ensures only one async operation can hold the lock at a time
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  /**
   * Acquire the mutex lock
   * If already locked, waits until it becomes available
   */
  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    // Already locked - wait in queue
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release the mutex lock
   * If there are waiters, the next one gets the lock
   */
  release(): void {
    if (this.queue.length > 0) {
      // Pass lock to next waiter
      const next = this.queue.shift()!;
      next();
    } else {
      this.locked = false;
    }
  }

  /**
   * Execute a function while holding the lock
   * Automatically releases the lock when done (or on error)
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /**
   * Check if the mutex is currently locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get the number of waiters in the queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }
}

/**
 * Manager for per-key mutexes
 * Useful for per-user or per-channel locking
 */
export class MutexManager {
  private mutexes = new Map<string, AsyncMutex>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private lastAccess = new Map<string, number>();

  constructor(
    /** Auto-cleanup mutexes not used for this many milliseconds */
    private cleanupAfterMs: number = 5 * 60 * 1000 // 5 minutes
  ) {
    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get or create a mutex for a given key
   */
  getMutex(key: string): AsyncMutex {
    this.lastAccess.set(key, Date.now());

    let mutex = this.mutexes.get(key);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.mutexes.set(key, mutex);
    }
    return mutex;
  }

  /**
   * Execute a function while holding the lock for a given key
   */
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.getMutex(key).withLock(fn);
  }

  /**
   * Remove a specific mutex (if not locked)
   */
  removeMutex(key: string): boolean {
    const mutex = this.mutexes.get(key);
    if (mutex && !mutex.isLocked()) {
      this.mutexes.delete(key);
      this.lastAccess.delete(key);
      return true;
    }
    return false;
  }

  /**
   * Get count of active mutexes
   */
  getCount(): number {
    return this.mutexes.size;
  }

  /**
   * Start periodic cleanup of unused mutexes
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, lastTime] of this.lastAccess.entries()) {
        if (now - lastTime > this.cleanupAfterMs) {
          this.removeMutex(key);
        }
      }
    }, this.cleanupAfterMs / 2);

    // Don't keep the process alive just for cleanup
    this.cleanupInterval.unref?.();
  }

  /**
   * Stop cleanup and clear all mutexes
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.mutexes.clear();
    this.lastAccess.clear();
  }
}

/**
 * Global mutex manager for per-user STM locking
 */
export const stmMutexManager = new MutexManager();
