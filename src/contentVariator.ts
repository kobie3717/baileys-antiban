/**
 * Content Variator — Auto-vary messages to avoid spam detection
 * 
 * WhatsApp flags identical messages sent to multiple recipients.
 * This module adds invisible variations so each message is technically unique.
 */

export interface VariatorConfig {
  /** Add zero-width characters between words (default: true) */
  zeroWidthChars: boolean;
  /** Vary punctuation (extra spaces, periods) (default: true) */
  punctuationVariation: boolean;
  /** Add random emoji padding (default: false) */
  emojiPadding: boolean;
  /** Synonym replacement for common words (default: false) */
  synonyms: boolean;
  /** Custom variation function */
  customVariator?: (text: string, index: number) => string;
}

const DEFAULT_CONFIG: VariatorConfig = {
  zeroWidthChars: true,
  punctuationVariation: true,
  emojiPadding: false,
  synonyms: false,
};

// Zero-width characters invisible to users
const ZERO_WIDTH = [
  '\u200B', // zero-width space
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\uFEFF', // zero-width no-break space
];

const SYNONYMS: Record<string, string[]> = {
  'hello': ['hi', 'hey', 'howdy'],
  'hi': ['hello', 'hey', 'howdy'],
  'thanks': ['thank you', 'thx', 'cheers'],
  'please': ['kindly', 'pls'],
  'great': ['awesome', 'excellent', 'wonderful'],
  'good': ['great', 'nice', 'fine'],
  'buy': ['purchase', 'get', 'grab'],
  'sell': ['offer', 'list'],
  'price': ['cost', 'amount', 'value'],
  'available': ['in stock', 'on offer'],
  'check': ['look at', 'see', 'view'],
  'join': ['participate', 'enter', 'come to'],
  'start': ['begin', 'kick off', 'commence'],
  'end': ['finish', 'close', 'conclude'],
  'bid': ['offer', 'place a bid'],
  'win': ['secure', 'take home'],
  'item': ['lot', 'piece', 'product'],
};

export class ContentVariator {
  private config: VariatorConfig;
  private counter = 0;

  constructor(config: Partial<VariatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a unique variation of a message
   * Each call produces a slightly different version
   */
  vary(text: string): string {
    let result = text;
    this.counter++;

    if (this.config.customVariator) {
      return this.config.customVariator(result, this.counter);
    }

    if (this.config.synonyms) {
      result = this.applySynonyms(result);
    }

    if (this.config.zeroWidthChars) {
      result = this.addZeroWidth(result);
    }

    if (this.config.punctuationVariation) {
      result = this.varyPunctuation(result);
    }

    if (this.config.emojiPadding) {
      result = this.addEmojiPadding(result);
    }

    return result;
  }

  /**
   * Create N unique variations of a message
   */
  varyBulk(text: string, count: number): string[] {
    const results: string[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < count; i++) {
      let variation = this.vary(text);
      // Ensure uniqueness
      let attempts = 0;
      while (seen.has(variation) && attempts < 10) {
        variation = this.vary(text);
        attempts++;
      }
      seen.add(variation);
      results.push(variation);
    }

    return results;
  }

  private addZeroWidth(text: string): string {
    const words = text.split(' ');
    if (words.length < 2) return text;

    // Insert 1-2 zero-width chars at random positions between words
    const positions = this.randomPositions(words.length - 1, Math.min(2, words.length - 1));
    
    return words.map((word, i) => {
      if (positions.includes(i)) {
        const zwc = ZERO_WIDTH[Math.floor(Math.random() * ZERO_WIDTH.length)];
        return word + zwc;
      }
      return word;
    }).join(' ');
  }

  private varyPunctuation(text: string): string {
    const variations = [
      // Trailing space variations
      () => text + ' ',
      () => text + '  ',
      // Period variations
      () => text.endsWith('.') ? text.slice(0, -1) : text + '.',
      // Nothing
      () => text,
      // Capitalize first letter variation
      () => text.charAt(0) === text.charAt(0).toUpperCase()
        ? text.charAt(0).toLowerCase() + text.slice(1)
        : text,
    ];

    return variations[this.counter % variations.length]();
  }

  private addEmojiPadding(text: string): string {
    const emojis = ['', ' 👍', ' ✅', ' 📌', ' 💬', ' 📢'];
    return text + emojis[this.counter % emojis.length];
  }

  private applySynonyms(text: string): string {
    const words = text.split(/\b/);
    let replaced = false;

    return words.map(word => {
      if (replaced) return word;
      const lower = word.toLowerCase();
      const synonymList = SYNONYMS[lower];
      if (synonymList && Math.random() > 0.5) {
        replaced = true; // Only replace one word per message
        const synonym = synonymList[Math.floor(Math.random() * synonymList.length)];
        // Preserve original casing
        return word[0] === word[0].toUpperCase()
          ? synonym.charAt(0).toUpperCase() + synonym.slice(1)
          : synonym;
      }
      return word;
    }).join('');
  }

  private randomPositions(max: number, count: number): number[] {
    const positions: number[] = [];
    while (positions.length < count) {
      const pos = Math.floor(Math.random() * max);
      if (!positions.includes(pos)) positions.push(pos);
    }
    return positions;
  }
}
