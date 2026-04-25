import { isGroup, isNewsletter, isBroadcast, applyGroupMultiplier } from '../src/profiles.js';

describe('JID detection', () => {
  test('isGroup: @g.us suffix', () => {
    expect(isGroup('120363000000000000@g.us')).toBe(true);
    expect(isGroup('27821234567@s.whatsapp.net')).toBe(false);
    expect(isGroup('27821234567@newsletter')).toBe(false);
  });

  test('isNewsletter: @newsletter suffix', () => {
    expect(isNewsletter('12345@newsletter')).toBe(true);
    expect(isNewsletter('27821234567@s.whatsapp.net')).toBe(false);
  });

  test('isBroadcast: status@broadcast', () => {
    expect(isBroadcast('status@broadcast')).toBe(true);
    expect(isBroadcast('27821234567@s.whatsapp.net')).toBe(false);
  });
});

describe('applyGroupMultiplier', () => {
  test('scales all three limits', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 10, maxPerHour: 300, maxPerDay: 1500 },
      0.5
    );
    expect(result.maxPerMinute).toBe(5);
    expect(result.maxPerHour).toBe(150);
    expect(result.maxPerDay).toBe(750);
  });

  test('rounds down to integer', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 7, maxPerHour: 100, maxPerDay: 300 },
      0.7
    );
    expect(result.maxPerMinute).toBe(4); // floor(4.9)
    expect(result.maxPerHour).toBe(70);
    expect(result.maxPerDay).toBe(210);
  });

  test('minimum 1 per limit', () => {
    const result = applyGroupMultiplier(
      { maxPerMinute: 1, maxPerHour: 1, maxPerDay: 1 },
      0.1
    );
    expect(result.maxPerMinute).toBe(1);
    expect(result.maxPerHour).toBe(1);
    expect(result.maxPerDay).toBe(1);
  });
});
