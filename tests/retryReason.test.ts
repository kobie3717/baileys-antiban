/**
 * Tests for MessageRetryReason enum and utilities (v2.1)
 */

import {
  MessageRetryReason,
  MAC_ERROR_CODES,
  parseRetryReason,
  isMacError,
  getRetryReasonDescription,
} from '../src/retryReason.js';

describe('RetryReason enum', () => {
  it('should have correct numeric values', () => {
    expect(MessageRetryReason.UnknownError).toBe(0);
    expect(MessageRetryReason.GenericError).toBe(1);
    expect(MessageRetryReason.SignalErrorInvalidKeyId).toBe(3);
    expect(MessageRetryReason.SignalErrorInvalidMessage).toBe(4);
    expect(MessageRetryReason.SignalErrorNoSession).toBe(5);
    expect(MessageRetryReason.SignalErrorBadMac).toBe(7);
    expect(MessageRetryReason.MessageExpired).toBe(8);
    expect(MessageRetryReason.DecryptionError).toBe(9);
  });
});

describe('MAC_ERROR_CODES', () => {
  it('should include all MAC-related error codes', () => {
    expect(MAC_ERROR_CODES.has(MessageRetryReason.SignalErrorBadMac)).toBe(true);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.SignalErrorInvalidMessage)).toBe(true);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.SignalErrorNoSession)).toBe(true);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.SignalErrorInvalidKeyId)).toBe(true);
  });

  it('should not include non-MAC error codes', () => {
    expect(MAC_ERROR_CODES.has(MessageRetryReason.UnknownError)).toBe(false);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.GenericError)).toBe(false);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.MessageExpired)).toBe(false);
    expect(MAC_ERROR_CODES.has(MessageRetryReason.DecryptionError)).toBe(false);
  });

  it('should have correct size', () => {
    expect(MAC_ERROR_CODES.size).toBe(4);
  });
});

describe('parseRetryReason', () => {
  it('should parse valid numeric codes', () => {
    expect(parseRetryReason(0)).toBe(MessageRetryReason.UnknownError);
    expect(parseRetryReason(1)).toBe(MessageRetryReason.GenericError);
    expect(parseRetryReason(3)).toBe(MessageRetryReason.SignalErrorInvalidKeyId);
    expect(parseRetryReason(4)).toBe(MessageRetryReason.SignalErrorInvalidMessage);
    expect(parseRetryReason(5)).toBe(MessageRetryReason.SignalErrorNoSession);
    expect(parseRetryReason(7)).toBe(MessageRetryReason.SignalErrorBadMac);
    expect(parseRetryReason(8)).toBe(MessageRetryReason.MessageExpired);
    expect(parseRetryReason(9)).toBe(MessageRetryReason.DecryptionError);
  });

  it('should parse valid string codes', () => {
    expect(parseRetryReason('0')).toBe(MessageRetryReason.UnknownError);
    expect(parseRetryReason('7')).toBe(MessageRetryReason.SignalErrorBadMac);
    expect(parseRetryReason('9')).toBe(MessageRetryReason.DecryptionError);
  });

  it('should return UnknownError for undefined', () => {
    expect(parseRetryReason(undefined)).toBe(MessageRetryReason.UnknownError);
  });

  it('should return UnknownError for null', () => {
    expect(parseRetryReason(null as any)).toBe(MessageRetryReason.UnknownError);
  });

  it('should return UnknownError for invalid numeric codes', () => {
    expect(parseRetryReason(2)).toBe(MessageRetryReason.UnknownError); // Gap in enum
    expect(parseRetryReason(6)).toBe(MessageRetryReason.UnknownError); // Gap in enum
    expect(parseRetryReason(100)).toBe(MessageRetryReason.UnknownError); // Out of range
    expect(parseRetryReason(-1)).toBe(MessageRetryReason.UnknownError); // Negative
  });

  it('should return UnknownError for invalid string codes', () => {
    expect(parseRetryReason('abc')).toBe(MessageRetryReason.UnknownError);
    expect(parseRetryReason('100')).toBe(MessageRetryReason.UnknownError);
    expect(parseRetryReason('')).toBe(MessageRetryReason.UnknownError);
  });
});

describe('isMacError', () => {
  it('should return true for MAC error codes', () => {
    expect(isMacError(MessageRetryReason.SignalErrorBadMac)).toBe(true);
    expect(isMacError(MessageRetryReason.SignalErrorInvalidMessage)).toBe(true);
    expect(isMacError(MessageRetryReason.SignalErrorNoSession)).toBe(true);
    expect(isMacError(MessageRetryReason.SignalErrorInvalidKeyId)).toBe(true);
  });

  it('should return false for non-MAC error codes', () => {
    expect(isMacError(MessageRetryReason.UnknownError)).toBe(false);
    expect(isMacError(MessageRetryReason.GenericError)).toBe(false);
    expect(isMacError(MessageRetryReason.MessageExpired)).toBe(false);
    expect(isMacError(MessageRetryReason.DecryptionError)).toBe(false);
  });
});

describe('getRetryReasonDescription', () => {
  it('should return correct descriptions for all enum values', () => {
    expect(getRetryReasonDescription(MessageRetryReason.UnknownError)).toContain('Unknown error');
    expect(getRetryReasonDescription(MessageRetryReason.GenericError)).toContain('Generic error');
    expect(getRetryReasonDescription(MessageRetryReason.SignalErrorInvalidKeyId)).toContain('Invalid key ID');
    expect(getRetryReasonDescription(MessageRetryReason.SignalErrorInvalidMessage)).toContain('Invalid message');
    expect(getRetryReasonDescription(MessageRetryReason.SignalErrorNoSession)).toContain('No session');
    expect(getRetryReasonDescription(MessageRetryReason.SignalErrorBadMac)).toContain('Bad MAC');
    expect(getRetryReasonDescription(MessageRetryReason.MessageExpired)).toContain('Message expired');
    expect(getRetryReasonDescription(MessageRetryReason.DecryptionError)).toContain('Decryption failed');
  });

  it('should handle invalid codes gracefully', () => {
    const description = getRetryReasonDescription(999 as MessageRetryReason);
    expect(description).toContain('Unknown reason code');
    expect(description).toContain('999');
  });
});

describe('Integration scenarios', () => {
  it('should correctly identify MAC errors from parsed codes', () => {
    const badMacCode = parseRetryReason(7);
    expect(isMacError(badMacCode)).toBe(true);
    expect(getRetryReasonDescription(badMacCode)).toContain('Bad MAC');
  });

  it('should handle string codes end-to-end', () => {
    const code = parseRetryReason('5');
    expect(code).toBe(MessageRetryReason.SignalErrorNoSession);
    expect(isMacError(code)).toBe(true);
    expect(getRetryReasonDescription(code)).toContain('No session');
  });

  it('should handle unknown codes end-to-end', () => {
    const code = parseRetryReason('999');
    expect(code).toBe(MessageRetryReason.UnknownError);
    expect(isMacError(code)).toBe(false);
    expect(getRetryReasonDescription(code)).toContain('Unknown error');
  });
});
