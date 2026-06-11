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
    pollIntervalMs?: number;
    logger?: {
        warn(msg: string, ctx?: object): void;
        info(msg: string, ctx?: object): void;
    };
}
export interface FleetEventStoreHandle {
    emit(eventType: FleetEventType, payload?: Record<string, unknown>): Promise<void>;
    startPolling(onNewEvents: (events: FleetEvent[]) => void): void;
    stop(): void;
}
export declare function createFleetEventStore(config: FleetEventStoreConfig): FleetEventStoreHandle;
type MySQLPool = {
    execute(sql: string, values: unknown[]): Promise<unknown>;
    query(sql: string): Promise<unknown>;
};
export declare function createMySQLEventStoreBackend(pool: MySQLPool): EventStoreBackend;
export declare function createInMemoryEventStoreBackend(): EventStoreBackend;
export {};
