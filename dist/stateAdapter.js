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
/**
 * Example file-based adapter using JSON files
 */
export class FileStateAdapter {
    basePath;
    constructor(basePath) {
        this.basePath = basePath;
    }
    async save(key, state) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(this.basePath, `${key}.json`);
        await fs.mkdir(this.basePath, { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
    }
    async load(key) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(this.basePath, `${key}.json`);
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
    async delete(key) {
        const fs = await import('fs/promises');
        const path = await import('path');
        const filePath = path.join(this.basePath, `${key}.json`);
        try {
            await fs.unlink(filePath);
        }
        catch (err) {
            if (err.code !== 'ENOENT')
                throw err;
        }
    }
    async list() {
        const fs = await import('fs/promises');
        try {
            const files = await fs.readdir(this.basePath);
            return files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace(/\.json$/, ''));
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return [];
            throw err;
        }
    }
}
