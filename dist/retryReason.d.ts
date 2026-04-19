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
export declare enum MessageRetryReason {
    UnknownError = 0,
    GenericError = 1,
    SignalErrorInvalidKeyId = 3,
    SignalErrorInvalidMessage = 4,
    SignalErrorNoSession = 5,
    SignalErrorBadMac = 7,
    MessageExpired = 8,
    DecryptionError = 9
}
/**
 * Set of retry reasons that indicate MAC verification failure.
 * These are the most common causes of "Bad MAC" errors in Baileys.
 */
export declare const MAC_ERROR_CODES: Set<MessageRetryReason>;
/**
 * Parse a retry reason code from various input formats.
 * Returns UnknownError if code is not recognized.
 */
export declare function parseRetryReason(code: string | number | undefined): MessageRetryReason;
/**
 * Check if a retry reason indicates a MAC error.
 * MAC errors are typically caused by encryption session mismatches,
 * often due to LID/PN race conditions.
 */
export declare function isMacError(reason: MessageRetryReason): boolean;
/**
 * Get a human-readable description of a retry reason.
 */
export declare function getRetryReasonDescription(reason: MessageRetryReason): string;
