import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateManager, type PersistedState } from '../src/persist.js';

function tmpPath(): string {
  return path.join(os.tmpdir(), `antiban-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function freshState(): PersistedState {
  return {
    warmup: { startedAt: Date.now(), lastActiveAt: Date.now(), dailyCounts: [], graduated: false },
    knownChats: [],
    savedAt: Date.now(),
    version: 3,
  };
}

afterEach(() => {
  const tmpDir = os.tmpdir();
  fs.readdirSync(tmpDir)
    .filter(f => f.startsWith('antiban-test-'))
    .forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
});

describe('StateManager', () => {
  test('load returns null for missing file', () => {
    const mgr = new StateManager('/tmp/nonexistent-antiban-xyz-99999.json');
    expect(mgr.load()).toBeNull();
  });

  test('load returns null for corrupt JSON, logs warn', () => {
    const p = tmpPath();
    fs.writeFileSync(p, 'not json {{{{');
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mgr = new StateManager(p);
    const result = mgr.load();
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('corrupt state'));
    spy.mockRestore();
  });

  test('load returns null for wrong version', () => {
    const p = tmpPath();
    const state = { ...freshState(), version: 2 };
    fs.writeFileSync(p, JSON.stringify(state));
    const mgr = new StateManager(p);
    expect(mgr.load()).toBeNull();
  });

  test('save + load round-trip', () => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    const state = freshState();
    state.knownChats = ['27821@s.whatsapp.net', '120363@g.us'];
    mgr.saveImmediate(state);
    const loaded = mgr.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.knownChats).toEqual(['27821@s.whatsapp.net', '120363@g.us']);
    expect(loaded!.version).toBe(3);
  });

  test('knownChats capped at 1000 on save', () => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    const state = freshState();
    state.knownChats = Array.from({ length: 1200 }, (_, i) => `${i}@s.whatsapp.net`);
    mgr.saveImmediate(state);
    const loaded = mgr.load();
    expect(loaded!.knownChats.length).toBe(1000);
    // Should keep LAST 1000 (most recent)
    expect(loaded!.knownChats[0]).toBe('200@s.whatsapp.net');
    expect(loaded!.knownChats[999]).toBe('1199@s.whatsapp.net');
  });

  test('saveDebounced does not write immediately', () => {
    const p = tmpPath();
    const mgr = new StateManager(p);
    mgr.saveDebounced(freshState());
    expect(fs.existsSync(p)).toBe(false); // not written yet
    mgr.flush(); // cancel the debounce
  });
});
