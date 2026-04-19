/**
 * TypedMessageRetryReason — Typed enum for WhatsApp's retry reason codes
 *
 * Based on protocol research from whatsapp-rust and Baileys source.
 * These codes appear in message retry events when encryption fails.
 *
 * Common scenarios:
 * - SignalErrorBadMac (7) — Most common, indicates encryption session mismatch
 * - SignalErrorNoSession (5) — Peer hasn't established session yet
 * - SignalErrorInvalidKeyId (3) — Peer's prekey rotated
 * - MessageExpired (8) — Message too old to decrypt
 *
 * @author Kobus Wentzel <kobie@pop.co.za>
 * @license MIT
 */

/**
 * WhatsApp message retry reason codes.
 * Based on Signal protocol error codes + WhatsApp extensions.
 */
export enum MessageRetryReason {
  UnknownError = 0,
  GenericError = 1,
  SignalErrorInvalidKeyId = 3,
  SignalErrorInvalidMessage = 4,
  SignalErrorNoSession = 5,
  SignalErrorBadMac = 7,
  MessageExpired = 8,
  DecryptionError = 9,
}

/**
 * Set of retry reasons that indicate MAC verification failure.
 * These are the most common causes of "Bad MAC" errors in Baileys.
 */
export const MAC_ERROR_CODES = new Set<MessageRetryReason>([
  MessageRetryReason.SignalErrorBadMac,
  MessageRetryReason.SignalErrorInvalidMessage,
  MessageRetryReason.SignalErrorNoSession,
  MessageRetryReason.SignalErrorInvalidKeyId,
]);

/**
 * Parse a retry reason code from various input formats.
 * Returns UnknownError if code is not recognized.
 */
export function parseRetryReason(code: string | number | undefined): MessageRetryReason {
  if (code === undefined || code === null) {
    return MessageRetryReason.UnknownError;
  }

  const n = typeof code === 'string' ? parseInt(code, 10) : code;

  if (isNaN(n)) {
    return MessageRetryReason.UnknownError;
  }

  // Check if the number is a valid enum value
  if (Object.values(MessageRetryReason).includes(n)) {
    return n as MessageRetryReason;
  }

  return MessageRetryReason.UnknownError;
}

/**
 * Check if a retry reason indicates a MAC error.
 * MAC errors are typically caused by encryption session mismatches,
 * often due to LID/PN race conditions.
 */
export function isMacError(reason: MessageRetryReason): boolean {
  return MAC_ERROR_CODES.has(reason);
}

/**
 * Get a human-readable description of a retry reason.
 */
export function getRetryReasonDescription(reason: MessageRetryReason): string {
  switch (reason) {
    case MessageRetryReason.UnknownError:
      return 'Unknown error';
    case MessageRetryReason.GenericError:
      return 'Generic error';
    case MessageRetryReason.SignalErrorInvalidKeyId:
      return 'Invalid key ID — peer prekey rotated';
    case MessageRetryReason.SignalErrorInvalidMessage:
      return 'Invalid message format';
    case MessageRetryReason.SignalErrorNoSession:
      return 'No session — peer not initialized';
    case MessageRetryReason.SignalErrorBadMac:
      return 'Bad MAC — encryption session mismatch';
    case MessageRetryReason.MessageExpired:
      return 'Message expired — too old to decrypt';
    case MessageRetryReason.DecryptionError:
      return 'Decryption failed';
    default:
      return `Unknown reason code ${reason}`;
  }
}
