/**
 * Smart Scheduler — Send messages during safe hours only
 * 
 * WhatsApp is more suspicious of messages sent at 3 AM.
 * This module ensures messages go out during "business hours"
 * and adds realistic daily activity patterns.
 */

export interface SchedulerConfig {
  /** Timezone (default: UTC) */
  timezone: string;
  /** Active hours [start, end] in 24h format (default: [8, 21]) */
  activeHours: [number, number];
  /** Reduce rate on weekends (default: 0.5 — half rate) */
  weekendFactor: number;
  /** Peak hours get slightly faster sending [start, end] (default: [10, 14]) */
  peakHours: [number, number];
  /** Peak hour speed multiplier (default: 1.3) */
  peakFactor: number;
  /** Lunch break — slight slowdown [start, end] (default: [12, 13]) */
  lunchBreak: [number, number];
  /** Lunch break speed factor (default: 0.5) */
  lunchFactor: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  timezone: 'UTC',
  activeHours: [8, 21],
  weekendFactor: 0.5,
  peakHours: [10, 14],
  peakFactor: 1.3,
  lunchBreak: [12, 13],
  lunchFactor: 0.5,
};

export class Scheduler {
  private config: SchedulerConfig;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if now is within active hours
   */
  isActiveTime(): boolean {
    const hour = this.getCurrentHour();
    const [start, end] = this.config.activeHours;
    return hour >= start && hour < end;
  }

  /**
   * Get the speed multiplier for current time
   * > 1 = faster, < 1 = slower, 0 = don't send
   */
  getSpeedFactor(): number {
    if (!this.isActiveTime()) return 0;

    const hour = this.getCurrentHour();
    const day = this.getCurrentDay();
    let factor = 1.0;

    // Weekend reduction
    if (day === 0 || day === 6) {
      factor *= this.config.weekendFactor;
    }

    // Peak hours boost
    const [peakStart, peakEnd] = this.config.peakHours;
    if (hour >= peakStart && hour < peakEnd) {
      factor *= this.config.peakFactor;
    }

    // Lunch slowdown
    const [lunchStart, lunchEnd] = this.config.lunchBreak;
    if (hour >= lunchStart && hour < lunchEnd) {
      factor *= this.config.lunchFactor;
    }

    return factor;
  }

  /**
   * Get ms until next active window
   */
  msUntilActive(): number {
    if (this.isActiveTime()) return 0;

    const now = new Date();
    const hour = now.getHours();
    const [start] = this.config.activeHours;

    let nextActive: Date;
    if (hour >= this.config.activeHours[1]) {
      // After hours — next active is tomorrow
      nextActive = new Date(now);
      nextActive.setDate(nextActive.getDate() + 1);
      nextActive.setHours(start, 0, 0, 0);
    } else {
      // Before hours — next active is today
      nextActive = new Date(now);
      nextActive.setHours(start, 0, 0, 0);
    }

    return nextActive.getTime() - now.getTime();
  }

  /**
   * Adjust a delay based on current time factors
   */
  adjustDelay(baseDelayMs: number): number {
    const factor = this.getSpeedFactor();
    if (factor === 0) return -1; // Don't send
    return Math.round(baseDelayMs / factor);
  }

  /**
   * Get current schedule status
   */
  getStatus() {
    const hour = this.getCurrentHour();
    const day = this.getCurrentDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      active: this.isActiveTime(),
      currentHour: hour,
      day: dayNames[day],
      isWeekend: day === 0 || day === 6,
      speedFactor: this.getSpeedFactor(),
      msUntilActive: this.msUntilActive(),
      activeWindow: `${this.config.activeHours[0]}:00 - ${this.config.activeHours[1]}:00`,
    };
  }

  private getCurrentHour(): number {
    return new Date().getHours();
  }

  private getCurrentDay(): number {
    return new Date().getDay();
  }
}
