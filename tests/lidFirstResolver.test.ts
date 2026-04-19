/**
 * Tests for LidFirstResolver (v2.1)
 */

import { LidFirstResolver, createLidFirstResolver } from '../src/lidFirstResolver.js';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');

describe('LidFirstResolver', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadFromAuthDir', () => {
    it('should load mappings from auth dir reverse files', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'lid-mapping-12345_reverse.json' as any,
        'other-file.json' as any,
      ]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
        '111222333444555@lid': '27123456789@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.size()).toBe(2);
      expect(resolver.resolveToLID('27825651069')).toBe('210543692497008@lid');
      expect(resolver.resolveToPhone('210543692497008@lid')).toBe('27825651069');
    });

    it('should handle non-existent auth dir gracefully', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(false);

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/nonexistent/dir');

      expect(resolver.size()).toBe(0);
    });

    it('should handle malformed JSON gracefully', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue('{ invalid json }');

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.size()).toBe(0); // Should not crash
    });

    it('should skip non-reverse-mapping files', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue([
        'lid-mapping-forward.json' as any,
        'other-file.json' as any,
      ]);

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(mockFs.readFileSync).not.toHaveBeenCalled();
      expect(resolver.size()).toBe(0);
    });

    it('should normalize device suffixes in LID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008:5@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      // Should normalize :5 suffix
      expect(resolver.resolveToLID('27825651069')).toBe('210543692497008@lid');
    });
  });

  describe('resolveToLID', () => {
    it('should resolve phone number to LID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.resolveToLID('27825651069')).toBe('210543692497008@lid');
    });

    it('should resolve phone JID to LID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.resolveToLID('27825651069@s.whatsapp.net')).toBe('210543692497008@lid');
    });

    it('should return null for unknown phone', () => {
      const resolver = new LidFirstResolver();
      expect(resolver.resolveToLID('27999999999')).toBeNull();
    });

    it('should handle device suffix in phone JID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.resolveToLID('27825651069:0@s.whatsapp.net')).toBe('210543692497008@lid');
    });
  });

  describe('resolveToPhone', () => {
    it('should resolve LID to phone number', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.resolveToPhone('210543692497008@lid')).toBe('27825651069');
    });

    it('should return null for unknown LID', () => {
      const resolver = new LidFirstResolver();
      expect(resolver.resolveToPhone('999999999@lid')).toBeNull();
    });

    it('should handle device suffix in LID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.resolveToPhone('210543692497008:3@lid')).toBe('27825651069');
    });
  });

  describe('getMapping', () => {
    it('should return full mapping for LID', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      const mapping = resolver.getMapping('210543692497008@lid');
      expect(mapping).toBeDefined();
      expect(mapping?.lid).toBe('210543692497008@lid');
      expect(mapping?.phone).toBe('27825651069');
      expect(mapping?.source).toBe('auth-dir');
    });

    it('should return full mapping for phone', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      const mapping = resolver.getMapping('27825651069@s.whatsapp.net');
      expect(mapping).toBeDefined();
      expect(mapping?.lid).toBe('210543692497008@lid');
      expect(mapping?.phone).toBe('27825651069');
    });

    it('should return null for unknown JID', () => {
      const resolver = new LidFirstResolver();
      expect(resolver.getMapping('unknown@s.whatsapp.net')).toBeNull();
    });
  });

  describe('learnFromEvent', () => {
    it('should accept message event without crashing', () => {
      const resolver = new LidFirstResolver();

      // This won't actually learn anything without paired data,
      // but should not crash
      resolver.learnFromEvent({
        key: {
          remoteJid: '27825651069@s.whatsapp.net',
          fromMe: false,
        },
      });

      // No assertion — just verify no crash
      expect(true).toBe(true);
    });

    it('should handle malformed event gracefully', () => {
      const resolver = new LidFirstResolver();

      resolver.learnFromEvent({ random: 'data' });
      resolver.learnFromEvent(null);
      resolver.learnFromEvent(undefined);

      expect(true).toBe(true); // Should not crash
    });
  });

  describe('utility methods', () => {
    it('should report size correctly', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
        '111222333444555@lid': '27123456789@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');

      expect(resolver.size()).toBe(2);
    });

    it('should clear all mappings', () => {
      const mockFs = fs as jest.Mocked<typeof fs>;
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readdirSync.mockReturnValue(['lid-mapping-12345_reverse.json' as any]);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({
        '210543692497008@lid': '27825651069@s.whatsapp.net',
      }));

      const resolver = new LidFirstResolver();
      resolver.loadFromAuthDir('/fake/auth/dir');
      expect(resolver.size()).toBe(1);

      resolver.clear();
      expect(resolver.size()).toBe(0);
      expect(resolver.resolveToLID('27825651069')).toBeNull();
    });
  });

  describe('factory function', () => {
    it('should create new resolver instance', () => {
      const resolver = createLidFirstResolver();
      expect(resolver).toBeInstanceOf(LidFirstResolver);
      expect(resolver.size()).toBe(0);
    });
  });
});
