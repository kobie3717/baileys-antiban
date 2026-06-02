/**
 * Fleet Event Store — Multi-instance coordination via shared event log
 *
 * Enables multiple WhatsApp instances to share ban/warn/recovery signals
 * via a pluggable backend (MySQL, in-memory, etc).
 *
 * Architecture:
 * - EventStoreBackend interface — caller provides storage
 * - Two built-in backends:
 *   1. MySQLEventStoreBackend — persistent, multi-instance (peer dep)
 *   2. InMemoryEventStoreBackend — ephemeral, single-instance, testing
 *
 * Usage with MySQL:
 *   import mysql from 'mysql2/promise';
 *   const pool = mysql.createPool({ ... });
 *   const backend = createMySQLEventStoreBackend(pool);
 *   const store = createFleetEventStore({
 *     connectionId: 'wa-instance-1',
 *     backend,
 *     pollIntervalMs: 10_000
 *   });
 *   store.emit('warn', { risk: 'medium' });
 *   store.startPolling((events) => console.log('New events:', events));
 *
 * Usage in-memory (testing):
 *   const backend = createInMemoryEventStoreBackend();
 *   const store = createFleetEventStore({ connectionId: 'test', backend });
 */

export type FleetEventType = 'ban' | 'warn' | 'rate_limit' | 'timelock' | 'recovery';

export interface FleetEvent {
  id: number | string;
  connectionId: string;
  eventType: FleetEventType;
  epoch: number;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export interface EventStoreBackend {
  /** Write an event. Must not throw — log and swallow on error. */
  emit(connectionId: string, eventType: FleetEventType, epoch: number, payload?: Record<string, unknown>): Promise<void>;
  /** Poll for new events since lastEpoch. Returns events sorted by epoch ASC. */
  poll(connectionId: string, sinceEpoch: number): Promise<FleetEvent[]>;
}

export interface FleetEventStoreConfig {
  connectionId: string;
  backend: EventStoreBackend;
  pollIntervalMs?: number; // default 10_000
  logger?: { warn(msg: string, ctx?: object): void; info(msg: string, ctx?: object): void };
}

export interface FleetEventStoreHandle {
  emit(eventType: FleetEventType, payload?: Record<string, unknown>): Promise<void>;
  startPolling(onNewEvents: (events: FleetEvent[]) => void): void;
  stop(): void;
}

export function createFleetEventStore(config: FleetEventStoreConfig): FleetEventStoreHandle {
  const { connectionId, backend, logger } = config;
  const pollIntervalMs = config.pollIntervalMs ?? 10_000;

  let lastSeenEpoch = Date.now();
  let pollTimer: NodeJS.Timeout | null = null;

  const emit: FleetEventStoreHandle['emit'] = async (eventType, payload) => {
    const epoch = Date.now();
    await backend.emit(connectionId, eventType, epoch, payload);
    logger?.info('[fleet-events] emitted', { connectionId, eventType, epoch });
  };

  const startPolling: FleetEventStoreHandle['startPolling'] = (onNewEvents) => {
    if (pollTimer) return;

    pollTimer = setInterval(() => {
      void (async () => {
        try {
          const events = await backend.poll(connectionId, lastSeenEpoch);

          if (events.length > 0) {
            // Update cursor
            const maxEpoch = Math.max(...events.map((e) => e.epoch));
            lastSeenEpoch = maxEpoch;

            onNewEvents(events);
          }
        } catch (error) {
          logger?.warn('[fleet-events] poll failed', { connectionId, err: error });
        }
      })();
    }, pollIntervalMs);

    // @ts-ignore — unref exists on NodeJS.Timeout
    pollTimer.unref?.();
    logger?.info('[fleet-events] polling started', { connectionId, pollIntervalMs });
  };

  const stop: FleetEventStoreHandle['stop'] = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
      logger?.info('[fleet-events] polling stopped', { connectionId });
    }
  };

  return { emit, startPolling, stop };
}

// ===============================
// Built-in Backend: MySQL
// ===============================

type MySQLPool = {
  execute(sql: string, values: unknown[]): Promise<unknown>;
  query(sql: string): Promise<unknown>;
};

type MySQLRow = {
  id: number;
  connection_id: string;
  event_type: string;
  epoch: number;
  payload: string | null;
  created_at: Date;
};

export function createMySQLEventStoreBackend(pool: MySQLPool): EventStoreBackend {
  // Ensure table exists on first emit (idempotent)
  let tableEnsured = false;

  const ensureTable = async (): Promise<void> => {
    if (tableEnsured) return;

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS antiban_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        connection_id VARCHAR(255) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        epoch BIGINT NOT NULL,
        payload JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_conn (connection_id),
        INDEX idx_epoch (epoch)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;

    try {
      await pool.query(createTableSQL);
      tableEnsured = true;
    } catch (error) {
      // Log but don't throw — table might already exist
      console.warn('[mysql-backend] table creation failed (may already exist)', error);
      tableEnsured = true; // Assume it exists
    }
  };

  const emit: EventStoreBackend['emit'] = async (connectionId, eventType, epoch, payload) => {
    try {
      await ensureTable();

      await pool.execute(
        'INSERT INTO antiban_events (connection_id, event_type, epoch, payload) VALUES (?, ?, ?, ?)',
        [connectionId, eventType, epoch, payload ? JSON.stringify(payload) : null]
      );
    } catch (error) {
      // Never throw — event emission is non-critical
      console.warn('[mysql-backend] emit failed', { connectionId, eventType, error });
    }
  };

  const poll: EventStoreBackend['poll'] = async (connectionId, sinceEpoch) => {
    try {
      await ensureTable();

      const [rows] = (await pool.execute(
        'SELECT id, connection_id, event_type, epoch, payload, created_at FROM antiban_events WHERE connection_id = ? AND epoch > ? ORDER BY epoch ASC LIMIT 50',
        [connectionId, sinceEpoch]
      )) as [MySQLRow[], unknown];

      return rows.map((row) => ({
        id: row.id,
        connectionId: row.connection_id,
        eventType: row.event_type as FleetEventType,
        epoch: row.epoch,
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
      }));
    } catch (error) {
      console.warn('[mysql-backend] poll failed', { connectionId, error });
      return [];
    }
  };

  return { emit, poll };
}

// ===============================
// Built-in Backend: In-Memory
// ===============================

export function createInMemoryEventStoreBackend(): EventStoreBackend {
  const events: FleetEvent[] = [];
  let nextId = 1;

  const emit: EventStoreBackend['emit'] = async (connectionId, eventType, epoch, payload) => {
    const event: FleetEvent = {
      id: nextId++,
      connectionId,
      eventType,
      epoch,
      payload: payload || null,
      createdAt: new Date(),
    };

    events.push(event);

    // Evict oldest if over 1000 entries
    if (events.length > 1000) {
      events.shift();
    }
  };

  const poll: EventStoreBackend['poll'] = async (connectionId, sinceEpoch) => {
    return events
      .filter((e) => e.connectionId === connectionId && e.epoch > sinceEpoch)
      .sort((a, b) => a.epoch - b.epoch)
      .slice(0, 50);
  };

  return { emit, poll };
}
