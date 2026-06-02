/**
 * LegitimacySignalInjector — Human imperfection signals
 *
 * WhatsApp's detection looks for accounts that are TOO perfect:
 * - Never make typos
 * - Always reply at consistent speeds
 * - Typing duration linearly correlates with message length
 *
 * This module injects realistic imperfections:
 * - Typos followed by corrections (2-3% of messages)
 * - Read-receipt without immediate reply (read gap)
 * - Mid-typing pauses for longer messages
 *
 * Note: Complements PresenceChoreographer, doesn't replace it.
 * PC handles timing/circadian rhythm; this handles content imperfections.
 */

export interface LegitimacySignalInjectorConfig {
  /** Enable typo injection (default: true) */
  enableTypos?: boolean;
  /** Probability per message of injecting a typo (default: 0.025 = 2.5%) */
  typoProbability?: number;
  /** Min delay before sending the correction in ms (default: 500) */
  typoCorrectMinMs?: number;
  /** Max delay before sending the correction in ms (default: 2000) */
  typoCorrectMaxMs?: number;
  /** Enable read-without-immediate-reply gaps (default: true) */
  enableReadGaps?: boolean;
  /** Probability of inserting a read gap before reply (default: 0.15) */
  readGapProbability?: number;
  /** Min read gap duration in ms (default: 300_000 = 5min) */
  readGapMinMs?: number;
  /** Max read gap duration in ms (default: 3_600_000 = 60min) */
  readGapMaxMs?: number;
  /** Enable mid-typing pauses for long messages (default: true) */
  enableTypingPauses?: boolean;
  /** Message length (chars) above which mid-typing pauses may be injected (default: 50) */
  typingPauseLengthThreshold?: number;
  /** Probability of injecting a pause per threshold-crossing (default: 0.4) */
  typingPauseProbability?: number;
  /** Min pause duration in ms (default: 1_500) */
  typingPauseMinMs?: number;
  /** Max pause duration in ms (default: 6_000) */
  typingPauseMaxMs?: number;
}

export interface LegitimacySignalStats {
  typosInjected: number;
  correctionsGenerated: number;
  readGapsInjected: number;
  typingPausesInjected: number;
}

export interface TypoResult {
  typoText: string;
  correctionDelay: number;
  correctionText: string;
}

export interface TypingPause {
  afterChars: number;
  pauseDurationMs: number;
}

const DEFAULT_CONFIG: Required<LegitimacySignalInjectorConfig> = {
  enableTypos: true,
  typoProbability: 0.025,
  typoCorrectMinMs: 500,
  typoCorrectMaxMs: 2000,
  enableReadGaps: true,
  readGapProbability: 0.15,
  readGapMinMs: 300_000,
  readGapMaxMs: 3_600_000,
  enableTypingPauses: true,
  typingPauseLengthThreshold: 50,
  typingPauseProbability: 0.4,
  typingPauseMinMs: 1_500,
  typingPauseMaxMs: 6_000,
};

/**
 * QWERTY keyboard adjacency map for realistic typos.
 * Maps common keys to their adjacent neighbors.
 */
const QWERTY_ADJACENT: Record<string, string[]> = {
  'a': ['q', 's', 'w', 'z'],
  'b': ['v', 'g', 'h', 'n'],
  'c': ['x', 'd', 'f', 'v'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'e': ['w', 'r', 'd', 's'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'i': ['u', 'o', 'k', 'j'],
  'j': ['h', 'u', 'i', 'k', 'n', 'm'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p'],
  'm': ['n', 'j', 'k'],
  'n': ['b', 'h', 'j', 'm'],
  'o': ['i', 'p', 'l', 'k'],
  'p': ['o', 'l'],
  'q': ['w', 'a'],
  'r': ['e', 't', 'f', 'd'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  't': ['r', 'y', 'g', 'f'],
  'u': ['y', 'i', 'j', 'h'],
  'v': ['c', 'f', 'g', 'b'],
  'w': ['q', 'e', 's', 'a'],
  'x': ['z', 's', 'd', 'c'],
  'y': ['t', 'u', 'h', 'g'],
  'z': ['a', 's', 'x'],
};

export class LegitimacySignalInjector {
  private config: Required<LegitimacySignalInjectorConfig>;
  private stats = {
    typosInjected: 0,
    correctionsGenerated: 0,
    readGapsInjected: 0,
    typingPausesInjected: 0,
  };

  constructor(config: LegitimacySignalInjectorConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Determine if a typo should be injected for this message.
   * Returns typo version of text + correction delay, or null if no typo.
   */
  shouldInjectTypo(text: string): TypoResult | null {
    if (!this.config.enableTypos) {
      return null;
    }

    // Only inject typos in messages > 10 chars
    if (text.length <= 10) {
      return null;
    }

    // Probability check
    if (Math.random() >= this.config.typoProbability) {
      return null;
    }

    // Don't inject typos in URLs
    if (this.containsUrl(text)) {
      return null;
    }

    // Extract words (excluding @mentions and numbers)
    const words = text.split(/\s+/);
    const eligibleWords = words.filter(
      word => word.length >= 3 && !word.startsWith('@') && !/^\d+$/.test(word)
    );

    if (eligibleWords.length === 0) {
      return null;
    }

    // Pick a random eligible word
    const targetWord = eligibleWords[Math.floor(Math.random() * eligibleWords.length)];
    const typoWord = this.injectTypoInWord(targetWord);

    if (!typoWord || typoWord === targetWord) {
      return null;
    }

    // Generate typo text
    const typoText = text.replace(targetWord, typoWord);

    // Generate correction
    const correctionDelay = this.randomBetween(
      this.config.typoCorrectMinMs,
      this.config.typoCorrectMaxMs
    );

    // Correction format: "*correctedword" for single word, or full message for short texts
    let correctionText: string;
    if (text.length < 30) {
      // Short message: resend the whole thing
      correctionText = text;
    } else {
      // Long message: use WA correction convention
      correctionText = `*${targetWord}`;
    }

    this.stats.typosInjected++;
    this.stats.correctionsGenerated++;

    return {
      typoText,
      correctionDelay,
      correctionText,
    };
  }

  /**
   * Determine if a read gap should be injected before sending a reply.
   * Returns gap duration in ms, or null if no gap.
   */
  shouldInjectReadGap(): number | null {
    if (!this.config.enableReadGaps) {
      return null;
    }

    if (Math.random() >= this.config.readGapProbability) {
      return null;
    }

    const gapMs = this.randomBetween(this.config.readGapMinMs, this.config.readGapMaxMs);
    this.stats.readGapsInjected++;
    return gapMs;
  }

  /**
   * For a message of given length, calculate mid-typing pause positions.
   * Returns array of { afterChars, pauseDurationMs } or empty array.
   */
  getTypingPauses(messageLength: number): TypingPause[] {
    if (!this.config.enableTypingPauses) {
      return [];
    }

    // Only for messages above threshold
    if (messageLength < this.config.typingPauseLengthThreshold) {
      return [];
    }

    // Probability check
    if (Math.random() >= this.config.typingPauseProbability) {
      return [];
    }

    const pauses: TypingPause[] = [];

    // Inject 1-2 pauses at natural break points
    const numPauses = Math.random() < 0.6 ? 1 : 2;

    for (let i = 0; i < numPauses; i++) {
      let position: number;

      if (i === 0) {
        // First pause around 40% mark
        position = Math.floor(messageLength * (0.35 + Math.random() * 0.15));
      } else {
        // Second pause around 70% mark
        position = Math.floor(messageLength * (0.65 + Math.random() * 0.15));
      }

      const pauseDurationMs = this.randomBetween(
        this.config.typingPauseMinMs,
        this.config.typingPauseMaxMs
      );

      pauses.push({
        afterChars: position,
        pauseDurationMs,
      });

      this.stats.typingPausesInjected++;
    }

    // Sort by position
    pauses.sort((a, b) => a.afterChars - b.afterChars);

    return pauses;
  }

  /**
   * Get statistics.
   */
  getStats(): LegitimacySignalStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics.
   */
  reset(): void {
    this.stats = {
      typosInjected: 0,
      correctionsGenerated: 0,
      readGapsInjected: 0,
      typingPausesInjected: 0,
    };
  }

  // Private helpers

  private injectTypoInWord(word: string): string | null {
    // Find a char that has QWERTY neighbors
    const chars = word.toLowerCase().split('');
    const eligibleIndices = chars
      .map((char, idx) => ({ char, idx }))
      .filter(({ char }) => QWERTY_ADJACENT[char] !== undefined);

    if (eligibleIndices.length === 0) {
      return null;
    }

    // Pick random position
    const target = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
    const neighbors = QWERTY_ADJACENT[target.char];
    const replacement = neighbors[Math.floor(Math.random() * neighbors.length)];

    // Preserve original casing
    const originalChar = word[target.idx];
    const replacementChar = originalChar === originalChar.toUpperCase()
      ? replacement.toUpperCase()
      : replacement;

    // Build typo word
    const typoChars = word.split('');
    typoChars[target.idx] = replacementChar;
    return typoChars.join('');
  }

  private containsUrl(text: string): boolean {
    return /https?:\/\/|www\./i.test(text);
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
