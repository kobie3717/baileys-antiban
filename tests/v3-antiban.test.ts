import { AntiBan } from '../src/antiban.js';

describe('AntiBan v3 constructor', () => {
  test('zero config — works, conservative defaults', async () => {
    const ab = new AntiBan();
    const result = await ab.beforeSend('27821234567@s.whatsapp.net', 'hello');
    expect(result.allowed).toBe(true);
    ab.destroy();
  });

  test('string preset "moderate"', () => {
    const ab = new AntiBan('moderate');
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(10);
    ab.destroy();
  });

  test('string preset "aggressive"', () => {
    const ab = new AntiBan('aggressive');
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(20);
    ab.destroy();
  });

  test('flat config object with preset override', () => {
    const ab = new AntiBan({ preset: 'moderate', maxPerMinute: 15 });
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(15);
    ab.destroy();
  });

  test('flat config without preset — conservative base', () => {
    const ab = new AntiBan({ maxPerDay: 999 });
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perDay).toBe(999);
    expect(stats.rateLimiter.limits.perMinute).toBe(5);
    ab.destroy();
  });

  test('invalid preset throws', () => {
    expect(() => new AntiBan('turbo' as any)).toThrow('Unknown preset');
  });

  test('v2 compat shim: nested config logs warn + still works', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const ab = new AntiBan({ rateLimiter: { maxPerMinute: 6 } } as any);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[baileys-antiban] DEPRECATED'));
    const stats = ab.getStats();
    expect(stats.rateLimiter.limits.perMinute).toBe(6);
    spy.mockRestore();
    ab.destroy();
  });

  test('groupProfiles: true — instance created without error', () => {
    const ab = new AntiBan({ preset: 'moderate', groupProfiles: true });
    expect(ab).toBeDefined();
    ab.destroy();
  });
});
