import type { BanRiskLevel, HealthStatus } from './health.js';
import type { TimelockState } from './timelockGuard.js';
export interface ResolvedConfig {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
    minDelayMs: number;
    maxDelayMs: number;
    newChatDelayMs: number;
    maxIdenticalMessages: number;
    identicalMessageWindowMs: number;
    burstAllowance: number;
    warmupDays: number;
    day1Limit: number;
    growthFactor: number;
    inactivityThresholdHours: number;
    autoPauseAt: BanRiskLevel;
    groupMultiplier: number;
    groupProfiles: boolean;
    persist?: string;
    logging: boolean;
    instanceCoordinator?: string;
    instancePoolMaxPerMinute?: number;
    instancePoolMaxPerHour?: number;
    onAtRisk?: (status: HealthStatus) => void;
    onRiskChange?: (status: HealthStatus) => void;
    onTimelockDetected?: (state: TimelockState) => void;
    onTimelockLifted?: (state: TimelockState) => void;
}
export type PresetName = 'conservative' | 'moderate' | 'aggressive' | 'high-volume';
export type AntiBanInput = PresetName | Partial<ResolvedConfig & {
    preset?: PresetName;
}> | undefined;
export declare const PRESETS: Record<PresetName, ResolvedConfig>;
export declare function resolveConfig(input: AntiBanInput): ResolvedConfig;
