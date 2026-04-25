import type { BanRiskLevel } from './health.js';
export interface ResolvedConfig {
    maxPerMinute: number;
    maxPerHour: number;
    maxPerDay: number;
    minDelayMs: number;
    maxDelayMs: number;
    newChatDelayMs: number;
    warmupDays: number;
    day1Limit: number;
    growthFactor: number;
    inactivityThresholdHours: number;
    autoPauseAt: BanRiskLevel;
    groupMultiplier: number;
    groupProfiles: boolean;
    persist?: string;
    logging: boolean;
}
export type PresetName = 'conservative' | 'moderate' | 'aggressive';
export type AntiBanInput = PresetName | Partial<ResolvedConfig & {
    preset?: PresetName;
}> | undefined;
export declare const PRESETS: Record<PresetName, ResolvedConfig>;
export declare function resolveConfig(input: AntiBanInput): ResolvedConfig;
