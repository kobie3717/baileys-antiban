import { describe, test, expect, afterEach, beforeEach } from 'vitest';
import { JidCanonicalizer } from '../src/jidCanonicalizer.js';
import { LidResolver } from '../src/lidResolver.js';

describe('JidCanonicalizer', () => {
  let canonicalizer: JidCanonicalizer;

  afterEach(() => {
    canonicalizer?.destroy();
  });

  describe('Learning from events', () => {
    beforeEach(() => {
      canonicalizer = new JidCanonicalizer({ enabled: true });
    });

    test('learns from messages.upsert with participant + participantPn', () => {
      const upsert = {
        messages: [
          {
            key: {
              remoteJid: 'group@g.us',
              participant: '123456789@lid',
              participantPn: '27825651069@s.whatsapp.net',
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      const stats = canonicalizer.getStats();
      expect(stats.inboundLearned).toBe(1);
      expect(stats.resolver.totalMappings).toBe(1);

      const mapping = canonicalizer.resolver.getMapping('123456789@lid');
      expect(mapping?.pn).toBe('27825651069@s.whatsapp.net');
    });

    test('learns from 1:1 messages with remoteJid + senderPn', () => {
      const upsert = {
        messages: [
          {
            key: {
              remoteJid: '123456789@lid',
              senderPn: '27825651069@s.whatsapp.net',
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      const stats = canonicalizer.getStats();
      expect(stats.inboundLearned).toBe(1);
      expect(stats.resolver.totalMappings).toBe(1);
    });

    test('learns from inverse case (participant PN + remoteJid LID)', () => {
      const upsert = {
        messages: [
          {
            key: {
              remoteJid: '123456789@lid',
              participant: '27825651069@s.whatsapp.net',
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      const stats = canonicalizer.getStats();
      expect(stats.inboundLearned).toBe(1);
    });

    test('handles messages without usable LID info', () => {
      const upsert = {
        messages: [
          {
            key: {
              remoteJid: '27825651069@s.whatsapp.net', // PN form, no LID
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      const stats = canonicalizer.getStats();
      expect(stats.inboundLearned).toBe(0);
    });

    test('processes multiple messages in one event', () => {
      const upsert = {
        messages: [
          {
            key: {
              participant: '111@lid',
              participantPn: '111@s.whatsapp.net',
            },
          },
          {
            key: {
              participant: '222@lid',
              participantPn: '222@s.whatsapp.net',
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      const stats = canonicalizer.getStats();
      expect(stats.inboundLearned).toBe(2);
      expect(stats.resolver.totalMappings).toBe(2);
    });

    test('does nothing when learnFromEvents disabled', () => {
      canonicalizer = new JidCanonicalizer({
        enabled: true,
        learnFromEvents: false,
      });

      const upsert = {
        messages: [
          {
            key: {
              participant: '123@lid',
              participantPn: '123@s.whatsapp.net',
            },
          },
        ],
      };

      canonicalizer.onIncomingEvent(upsert);

      expect(canonicalizer.getStats().inboundLearned).toBe(0);
    });
  });

  describe('Outbound canonicalization', () => {
    beforeEach(() => {
      canonicalizer = new JidCanonicalizer({
        enabled: true,
        resolverConfig: { canonical: 'pn' },
      });

      // Pre-seed mapping
      canonicalizer.resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });
    });

    test('canonicalizes LID to PN when mapping exists', () => {
      const canonical = canonicalizer.canonicalizeTarget('123456789@lid');
      expect(canonical).toBe('27825651069@s.whatsapp.net');

      const stats = canonicalizer.getStats();
      expect(stats.outboundCanonicalized).toBe(1);
    });

    test('returns PN as-is when already canonical', () => {
      const canonical = canonicalizer.canonicalizeTarget('27825651069@s.whatsapp.net');
      expect(canonical).toBe('27825651069@s.whatsapp.net');

      const stats = canonicalizer.getStats();
      expect(stats.outboundPassthrough).toBe(1);
    });

    test('returns original when mapping unknown', () => {
      const canonical = canonicalizer.canonicalizeTarget('unknown@lid');
      expect(canonical).toBe('unknown@lid');

      const stats = canonicalizer.getStats();
      expect(stats.outboundPassthrough).toBe(1);
    });

    test('does nothing when canonicalizeOutbound disabled', () => {
      canonicalizer = new JidCanonicalizer({
        enabled: true,
        canonicalizeOutbound: false,
      });

      canonicalizer.resolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      const canonical = canonicalizer.canonicalizeTarget('123@lid');
      expect(canonical).toBe('123@lid'); // No transformation
    });

    test('does nothing when module disabled', () => {
      canonicalizer = new JidCanonicalizer({ enabled: false });

      const canonical = canonicalizer.canonicalizeTarget('123@lid');
      expect(canonical).toBe('123@lid');
    });
  });

  describe('Shared resolver', () => {
    test('uses provided resolver instead of creating new one', () => {
      const sharedResolver = new LidResolver({ canonical: 'pn' });
      sharedResolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      const can1 = new JidCanonicalizer({
        enabled: true,
        resolver: sharedResolver,
      });

      const can2 = new JidCanonicalizer({
        enabled: true,
        resolver: sharedResolver,
      });

      // Both should see the same mapping
      expect(can1.resolver.getStats().totalMappings).toBe(1);
      expect(can2.resolver.getStats().totalMappings).toBe(1);

      // Learning via can1 should update can2
      can1.onIncomingEvent({
        messages: [
          {
            key: {
              participant: '456@lid',
              participantPn: '456@s.whatsapp.net',
            },
          },
        ],
      });

      expect(can2.resolver.getStats().totalMappings).toBe(2);

      can1.destroy();
      can2.destroy();
      sharedResolver.destroy();
    });

    test('does not destroy shared resolver on destroy', () => {
      const sharedResolver = new LidResolver();
      sharedResolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      canonicalizer = new JidCanonicalizer({
        enabled: true,
        resolver: sharedResolver,
      });

      canonicalizer.destroy();

      // Shared resolver should still work
      expect(sharedResolver.getStats().totalMappings).toBe(1);

      sharedResolver.destroy();
    });

    test('destroys owned resolver on destroy', () => {
      canonicalizer = new JidCanonicalizer({ enabled: true });
      canonicalizer.resolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      expect(canonicalizer.resolver.getStats().totalMappings).toBe(1);

      canonicalizer.destroy();

      // Owned resolver should be destroyed (cleared)
      expect(canonicalizer.resolver.getStats().totalMappings).toBe(0);
    });
  });

  describe('onMessageUpdate', () => {
    beforeEach(() => {
      canonicalizer = new JidCanonicalizer({ enabled: true });
    });

    test('learns from update.key if present', () => {
      const updates = [
        {
          key: {
            participant: '123@lid',
            participantPn: '123@s.whatsapp.net',
          },
          status: 1,
        },
      ];

      canonicalizer.onMessageUpdate(updates);

      expect(canonicalizer.getStats().inboundLearned).toBe(1);
    });

    test('handles updates without key gracefully', () => {
      const updates = [
        {
          status: 1,
        },
      ];

      canonicalizer.onMessageUpdate(updates);

      expect(canonicalizer.getStats().inboundLearned).toBe(0);
    });

    test('does nothing when learnFromEvents disabled', () => {
      canonicalizer = new JidCanonicalizer({
        enabled: true,
        learnFromEvents: false,
      });

      const updates = [
        {
          key: {
            participant: '123@lid',
            participantPn: '123@s.whatsapp.net',
          },
        },
      ];

      canonicalizer.onMessageUpdate(updates);

      expect(canonicalizer.getStats().inboundLearned).toBe(0);
    });
  });

  describe('Stats', () => {
    test('returns comprehensive stats', () => {
      canonicalizer = new JidCanonicalizer({ enabled: true });

      canonicalizer.resolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      canonicalizer.onIncomingEvent({
        messages: [
          {
            key: {
              participant: '456@lid',
              participantPn: '456@s.whatsapp.net',
            },
          },
        ],
      });

      canonicalizer.canonicalizeTarget('123@lid');
      canonicalizer.canonicalizeTarget('unknown@lid');

      const stats = canonicalizer.getStats();
      expect(stats.resolver.totalMappings).toBe(2);
      expect(stats.inboundLearned).toBe(1);
      expect(stats.outboundCanonicalized).toBe(1);
      expect(stats.outboundPassthrough).toBe(1);
    });
  });

  describe('canonicalKey', () => {
    beforeEach(() => {
      canonicalizer = new JidCanonicalizer({ enabled: true });
    });

    test('PN form returns thread:<digits>', () => {
      const key = canonicalizer.canonicalKey('27825651069@s.whatsapp.net');
      expect(key).toBe('thread:27825651069');
    });

    test('LID with known PN returns thread:<digits>', () => {
      canonicalizer.resolver.learn({
        lid: '123456789@lid',
        pn: '27825651069@s.whatsapp.net',
      });

      const key = canonicalizer.canonicalKey('123456789@lid');
      expect(key).toBe('thread:27825651069');

      const stats = canonicalizer.getStats();
      expect(stats.canonicalKeyHits).toBe(1);
      expect(stats.canonicalKeyMisses).toBe(0);
    });

    test('LID without PN returns thread:lid:<digits>', () => {
      const key = canonicalizer.canonicalKey('123456789@lid');
      expect(key).toBe('thread:lid:123456789');

      const stats = canonicalizer.getStats();
      expect(stats.canonicalKeyHits).toBe(0);
      expect(stats.canonicalKeyMisses).toBe(1);
    });

    test('Group JID returns thread:group:<id>', () => {
      const key = canonicalizer.canonicalKey('1234567890-1234567890@g.us');
      expect(key).toBe('thread:group:1234567890-1234567890');
    });

    test('Broadcast returns thread:broadcast:status', () => {
      const key = canonicalizer.canonicalKey('status@broadcast');
      expect(key).toBe('thread:broadcast:status');
    });

    test('Newsletter returns thread:newsletter:<id>', () => {
      const key = canonicalizer.canonicalKey('abc123@newsletter');
      expect(key).toBe('thread:newsletter:abc123');
    });

    test('Empty/null/malformed returns thread:invalid', () => {
      expect(canonicalizer.canonicalKey('')).toBe('thread:invalid');
      expect(canonicalizer.canonicalKey('   ')).toBe('thread:invalid');
      expect(canonicalizer.canonicalKey('no-at-sign')).toBe('thread:invalid');
    });

    test('Normalizes case and whitespace', () => {
      const key1 = canonicalizer.canonicalKey('  27825651069@s.whatsapp.net  ');
      const key2 = canonicalizer.canonicalKey('27825651069@S.WHATSAPP.NET');
      expect(key1).toBe('thread:27825651069');
      expect(key2).toBe('thread:27825651069');
    });

    test('Stats counters increment correctly', () => {
      canonicalizer.resolver.learn({
        lid: '123@lid',
        pn: '123@s.whatsapp.net',
      });

      // Hit: PN form
      canonicalizer.canonicalKey('456@s.whatsapp.net');
      expect(canonicalizer.getStats().canonicalKeyHits).toBe(1);
      expect(canonicalizer.getStats().canonicalKeyMisses).toBe(0);

      // Hit: LID with known PN
      canonicalizer.canonicalKey('123@lid');
      expect(canonicalizer.getStats().canonicalKeyHits).toBe(2);
      expect(canonicalizer.getStats().canonicalKeyMisses).toBe(0);

      // Miss: LID without PN
      canonicalizer.canonicalKey('unknown@lid');
      expect(canonicalizer.getStats().canonicalKeyHits).toBe(2);
      expect(canonicalizer.getStats().canonicalKeyMisses).toBe(1);
    });

    test('Unknown domain returns thread:<domain>:<user>', () => {
      const key = canonicalizer.canonicalKey('user@unknown.domain');
      expect(key).toBe('thread:unknown.domain:user');
    });
  });
});
