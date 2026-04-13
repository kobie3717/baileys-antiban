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
export declare class FileStateAdapter implements StateAdapter {
    private basePath;
    constructor(basePath: string);
    save(key: string, state: any): Promise<void>;
    load(key: string): Promise<any | null>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
}
