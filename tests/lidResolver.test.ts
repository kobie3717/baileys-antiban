import { LidResolver } from '../src/lidResolver.js';

describe('LidResolver', () => {
  let resolver: LidResolver;

  beforeEach(() => {
    resolver = new LidResolver({ canonical: 'pn' });
  });

  afterEach(() => {
    resolver.destroy();
  });

  describe('Learning mappings', () => {
    test('learns LID→PN mapping from full info', () => {
      resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });

      const mapping = resolver.getMapping('123456789@lid');
      expect(mapping).toBeTruthy();
      expect(mapping?.lid).toBe('123456789@lid');
      expect(mapping?.pn).toBe('27825651069@s.whatsapp.net');
      expect(mapping?.phone).toBe('27825651069');
      expect(mapping?.seenCount).toBe(1);
    });

    test('learns from phone + lid (derives PN)', () => {
      resolver.learn({
        lid: '123456789@lid',
        phone: '27825651069',
      });

      const mapping = resolver.getMapping('123456789@lid');
      expect(mapping).toBeTruthy();
      expect(mapping?.pn).toBe('27825651069@s.whatsapp.net');
      expect(mapping?.phone).toBe('27825651069');
    });

    test('ignores incomplete data (lid only)', () => {
      resolver.learn({ lid: '123456789@lid' });

      expect(resolver.getMapping('123456789@lid')).toBeNull();
      expect(resolver.getStats().learnedFromEvents).toBe(0);
    });

    test('ignores incomplete data (pn only)', () => {
      resolver.learn({ pn: '27825651069@s.whatsapp.net' });

      expect(resolver.getMapping('27825651069@s.whatsapp.net')).toBeNull();
      expect(resolver.getStats().learnedFromEvents).toBe(0);
    });

    test('increments seenCount on re-learn', () => {
      const data = {
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      };

      resolver.learn(data);
      resolver.learn(data);
      resolver.learn(data);

      const mapping = resolver.getMapping('123456789@lid');
      expect(mapping?.seenCount).toBe(3);
      expect(resolver.getStats().learnedFromEvents).toBe(1); // Only counted first time
    });

    test('strips device suffix from JIDs', () => {
      resolver.learn({
        lid: '123456789:10@lid',
        pn: '27825651069:20@s.whatsapp.net',
      });

      const mapping = resolver.getMapping('123456789@lid');
      expect(mapping).toBeTruthy();
      expect(mapping?.lid).toBe('123456789@lid');
      expect(mapping?.pn).toBe('27825651069@s.whatsapp.net');
    });

    test('validates LID form (must end with @lid)', () => {
      resolver.learn({
        lid: '123456789@s.whatsapp.net', // Wrong form
        pn: '27825651069@s.whatsapp.net',
      });

      expect(resolver.getStats().learnedFromEvents).toBe(0);
    });

    test('validates PN form (must end with @s.whatsapp.net)', () => {
      resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@lid', // Wrong form
      });

      expect(resolver.getStats().learnedFromEvents).toBe(0);
    });
  });

  describe('Canonical resolution (canonical=pn)', () => {
    beforeEach(() => {
      resolver = new LidResolver({ canonical: 'pn' });
      resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });
    });

    test('resolves LID to PN when mapping known', () => {
      const canonical = resolver.resolveCanonical('123456789@lid');
      expect(canonical).toBe('27825651069@s.whatsapp.net');
    });

    test('returns PN as-is when already PN form', () => {
      const canonical = resolver.resolveCanonical('27825651069@s.whatsapp.net');
      expect(canonical).toBe('27825651069@s.whatsapp.net');
    });

    test('falls back to original when mapping unknown', () => {
      const canonical = resolver.resolveCanonical('unknown123@lid');
      expect(canonical).toBe('unknown123@lid');
    });

    test('increments lookupsServed stat', () => {
      resolver.resolveCanonical('123456789@lid');
      resolver.resolveCanonical('27825651069@s.whatsapp.net');

      const stats = resolver.getStats();
      expect(stats.lookupsServed).toBe(2);
    });

    test('increments lookupMisses on unknown', () => {
      resolver.resolveCanonical('unknown@lid');

      const stats = resolver.getStats();
      expect(stats.lookupMisses).toBe(1);
    });
  });

  describe('Canonical resolution (canonical=lid)', () => {
    beforeEach(() => {
      resolver = new LidResolver({ canonical: 'lid' });
      resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });
    });

    test('resolves PN to LID when mapping known', () => {
      const canonical = resolver.resolveCanonical('27825651069@s.whatsapp.net');
      expect(canonical).toBe('123456789@lid');
    });

    test('returns LID as-is when already LID form', () => {
      const canonical = resolver.resolveCanonical('123456789@lid');
      expect(canonical).toBe('123456789@lid');
    });

    test('falls back to original when mapping unknown', () => {
      const canonical = resolver.resolveCanonical('unknown@s.whatsapp.net');
      expect(canonical).toBe('unknown@s.whatsapp.net');
    });
  });

  describe('Lookup methods', () => {
    beforeEach(() => {
      resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });
    });

    test('getLid returns LID for known PN', () => {
      const lid = resolver.getLid('27825651069@s.whatsapp.net');
      expect(lid).toBe('123456789@lid');
    });

    test('getLid returns null for unknown PN', () => {
      const lid = resolver.getLid('unknown@s.whatsapp.net');
      expect(lid).toBeNull();
    });

    test('getPn returns PN for known LID', () => {
      const pn = resolver.getPn('123456789@lid');
      expect(pn).toBe('27825651069@s.whatsapp.net');
    });

    test('getPn returns null for unknown LID', () => {
      const pn = resolver.getPn('unknown@lid');
      expect(pn).toBeNull();
    });

    test('getMapping works with both LID and PN forms', () => {
      const byLid = resolver.getMapping('123456789@lid');
      const byPn = resolver.getMapping('27825651069@s.whatsapp.net');

      expect(byLid).toEqual(byPn);
      expect(byLid?.lid).toBe('123456789@lid');
    });
  });

  describe('LRU eviction', () => {
    test('evicts oldest when maxEntries exceeded', () => {
      resolver = new LidResolver({ maxEntries: 3 });

      // Add 3 mappings
      resolver.learn({ lid: '111@lid', pn: '111@s.whatsapp.net' });
      resolver.learn({ lid: '222@lid', pn: '222@s.whatsapp.net' });
      resolver.learn({ lid: '333@lid', pn: '333@s.whatsapp.net' });

      expect(resolver.getStats().totalMappings).toBe(3);

      // Add 4th — should evict oldest (111)
      resolver.learn({ lid: '444@lid', pn: '444@s.whatsapp.net' });

      expect(resolver.getStats().totalMappings).toBe(3);
      expect(resolver.getMapping('111@lid')).toBeNull();
      expect(resolver.getMapping('444@lid')).toBeTruthy();
    });

    test('updates LRU timestamp on access', async () => {
      resolver = new LidResolver({ maxEntries: 2 });

      resolver.learn({ lid: '111@lid', pn: '111@s.whatsapp.net' });
      await new Promise(resolve => setTimeout(resolve, 5)); // Small delay to ensure different timestamps
      resolver.learn({ lid: '222@lid', pn: '222@s.whatsapp.net' });

      // Access 111 to bump its timestamp
      await new Promise(resolve => setTimeout(resolve, 5));
      resolver.getMapping('111@lid');

      // Add 3rd — should evict 222 (older access time)
      await new Promise(resolve => setTimeout(resolve, 5));
      resolver.learn({ lid: '333@lid', pn: '333@s.whatsapp.net' });

      expect(resolver.getMapping('111@lid')).toBeTruthy();
      expect(resolver.getMapping('222@lid')).toBeNull();
      expect(resolver.getMapping('333@lid')).toBeTruthy();
    });
  });

  describe('Persistence', () => {
    test('hydrate loads from persistence', async () => {
      const mockLoad = jest.fn().mockResolvedValue({
        '123@lid': {
          lid: '123@lid',
          pn: '123@s.whatsapp.net',
          phone: '123',
          learnedAt: Date.now(),
          seenCount: 5,
        },
      });

      resolver = new LidResolver({
        persistence: { load: mockLoad },
      });

      await resolver.hydrate();

      expect(mockLoad).toHaveBeenCalled();
      expect(resolver.getMapping('123@lid')).toBeTruthy();
      expect(resolver.getStats().totalMappings).toBe(1);
    });

    test('flush saves to persistence', async () => {
      const mockSave = jest.fn().mockResolvedValue(undefined);

      resolver = new LidResolver({
        persistence: { save: mockSave },
      });

      resolver.learn({ lid: '123@lid', pn: '123@s.whatsapp.net' });
      await resolver.flush();

      expect(mockSave).toHaveBeenCalled();
      const saved = mockSave.mock.calls[0][0];
      expect(saved['123@lid']).toBeTruthy();
    });

    test('handles corrupt persistence gracefully', async () => {
      const mockLoad = jest.fn().mockRejectedValue(new Error('Corrupt'));

      resolver = new LidResolver({
        persistence: { load: mockLoad },
      });

      await resolver.hydrate();

      // Should not crash
      expect(resolver.getStats().totalMappings).toBe(0);
    });

    test('flushes on destroy', async () => {
      const mockSave = jest.fn().mockResolvedValue(undefined);

      resolver = new LidResolver({
        persistence: { save: mockSave },
      });

      resolver.learn({ lid: '123@lid', pn: '123@s.whatsapp.net' });
      resolver.destroy();

      // Flush is async, give it a tick
      await new Promise(resolve => setImmediate(resolve));
      expect(mockSave).toHaveBeenCalled();
    });
  });

  describe('Stats', () => {
    test('returns accurate statistics', () => {
      resolver.learn({ lid: '111@lid', pn: '111@s.whatsapp.net' });
      resolver.learn({ lid: '222@lid', pn: '222@s.whatsapp.net' });
      resolver.resolveCanonical('111@lid');
      resolver.resolveCanonical('unknown@lid');

      const stats = resolver.getStats();
      expect(stats.totalMappings).toBe(2);
      expect(stats.learnedFromEvents).toBe(2);
      expect(stats.lookupsServed).toBe(1);
      expect(stats.lookupMisses).toBe(1);
      expect(stats.canonicalForm).toBe('pn');
    });
  });

  describe('Reset', () => {
    test('clears all mappings and stats', () => {
      resolver.learn({ lid: '111@lid', pn: '111@s.whatsapp.net' });
      resolver.resolveCanonical('111@lid');

      resolver.reset();

      expect(resolver.getStats().totalMappings).toBe(0);
      expect(resolver.getStats().learnedFromEvents).toBe(0);
      expect(resolver.getStats().lookupsServed).toBe(0);
      expect(resolver.getMapping('111@lid')).toBeNull();
    });
  });
});
