/**
 * v3.2 Smoke Test
 * Quick manual verification of new modules
 */

import { generateFingerprint, applyFingerprint } from '../dist/deviceFingerprint.js';
import { credsSnapshot } from '../dist/credsSnapshot.js';
import { readReceiptVariance } from '../dist/readReceiptVariance.js';

console.log('=== v3.2 Smoke Test ===\n');

// 1. Device Fingerprint
console.log('1. Device Fingerprint');
const fp1 = generateFingerprint({ seed: 'test-session-1' });
console.log('  Fingerprint 1:', {
  appVersion: fp1.appVersion.join('.'),
  osVersion: fp1.osVersion,
  deviceModel: fp1.deviceModel,
});

const fp2 = generateFingerprint({ seed: 'test-session-2' });
console.log('  Fingerprint 2:', {
  appVersion: fp2.appVersion.join('.'),
  osVersion: fp2.osVersion,
  deviceModel: fp2.deviceModel,
});

const config = applyFingerprint({}, fp1);
console.log('  Applied to config:', {
  version: config.version,
  browser: config.browser,
});

// 2. Creds Snapshot
console.log('\n2. Creds Snapshot');
const snapshot = credsSnapshot({
  credsPath: '/tmp/test-creds.json',
  keep: 3,
  logger: {
    info: (msg) => console.log('  [INFO]', msg),
    warn: (msg) => console.log('  [WARN]', msg),
    error: (msg) => console.log('  [ERROR]', msg),
  },
});
console.log('  Created snapshot instance');

// 3. Read Receipt Variance
console.log('\n3. Read Receipt Variance');
const variance = readReceiptVariance({
  meanMs: 1500,
  stdDevMs: 800,
  minMs: 200,
  maxMs: 8000,
});

const delays = Array.from({ length: 5 }, () => variance.delayMs());
console.log('  Sample delays (ms):', delays.map((d) => Math.round(d)));

const mockSock = {
  readMessages: async (keys) => {
    console.log('  readMessages called with', keys.length, 'keys');
    return { success: true };
  },
};

const wrapped = variance.wrap(mockSock);
console.log('  Wrapped socket:', typeof wrapped.readMessages === 'function' ? 'OK' : 'FAIL');

console.log('\n=== All modules loaded successfully ===');
