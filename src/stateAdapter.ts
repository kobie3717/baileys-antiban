/**
 * State Adapter — Interface for persisting anti-ban state to disk/DB
 *
 * Implement this interface to save/load state between restarts.
 * Without persistence, warm-up progress is lost on every restart.
 *
 * Example implementations:
 * - File-based: JSON files in a directory
 * - Database: SQLite, PostgreSQL, MongoDB
 * - Redis: For distributed systems
 *
 * Usage:
 *   const adapter = new FileStateAdapter('./state');
 *   const antiban = new AntiBan({ stateAdapter: adapter });
 *   await antiban.loadState(); // On startup
 *   await antiban.saveState(); // Periodically or on shutdown
 */

export interface StateAdapter {
  /**
   * Save state to persistent storage
   * @param key Unique identifier for the state (e.g., 'warmup', 'health', 'ratelimiter')
   * @param state The state object to persist
   */
  save(key: string, state: any): Promise<void>;

  /**
   * Load state from persistent storage
   * @param key Unique identifier for the state
   * @returns The stored state, or null if not found
   */
  load(key: string): Promise<any | null>;

  /**
   * Delete state from persistent storage
   * @param key Unique identifier for the state
   */
  delete(key: string): Promise<void>;

  /**
   * List all stored state keys
   * @returns Array of state keys
   */
  list(): Promise<string[]>;
}

/**
 * Example file-based adapter using JSON files
 */
export class FileStateAdapter implements StateAdapter {
  constructor(private basePath: string) {}

  async save(key: string, state: any): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(this.basePath, `${key}.json`);
    await fs.mkdir(this.basePath, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async load(key: string): Promise<any | null> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(this.basePath, `${key}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.join(this.basePath, `${key}.json`);
    try {
      await fs.unlink(filePath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  async list(): Promise<string[]> {
    const fs = await import('fs/promises');
    try {
      const files = await fs.readdir(this.basePath);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace(/\.json$/, ''));
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }
}
