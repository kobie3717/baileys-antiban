import { resolveConfig, PRESETS } from '../src/presets.js';

describe('resolveConfig', () => {
  test('undefined → conservative preset', () => {
    const cfg = resolveConfig(undefined);
    expect(cfg.maxPerMinute).toBe(5);
    expect(cfg.maxPerHour).toBe(100);
    expect(cfg.warmupDays).toBe(10);
    expect(cfg.groupMultiplier).toBe(0.5);
    expect(cfg.autoPauseAt).toBe('medium');
  });

  test('string "moderate" → moderate preset', () => {
    const cfg = resolveConfig('moderate');
    expect(cfg.maxPerMinute).toBe(10);
    expect(cfg.maxPerHour).toBe(300);
    expect(cfg.groupMultiplier).toBe(0.7);
  });

  test('string "aggressive" → aggressive preset', () => {
    const cfg = resolveConfig('aggressive');
    expect(cfg.maxPerMinute).toBe(20);
    expect(cfg.autoPauseAt).toBe('critical');
  });

  test('flat config with preset → merges overrides', () => {
    const cfg = resolveConfig({ preset: 'moderate', maxPerMinute: 15 });
    expect(cfg.maxPerMinute).toBe(15);  // override wins
    expect(cfg.maxPerHour).toBe(300);   // preset default
  });

  test('flat config without preset → conservative base', () => {
    const cfg = resolveConfig({ maxPerDay: 999 });
    expect(cfg.maxPerDay).toBe(999);
    expect(cfg.maxPerMinute).toBe(5); // conservative default
  });

  test('invalid preset string → throws', () => {
    expect(() => resolveConfig('turbo' as any)).toThrow('Unknown preset');
  });

  test('all preset names exist in PRESETS', () => {
    expect(PRESETS.conservative).toBeDefined();
    expect(PRESETS.moderate).toBeDefined();
    expect(PRESETS.aggressive).toBeDefined();
  });
});
