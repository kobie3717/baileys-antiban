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
export declare class ContentVariator {
    private config;
    private counter;
    constructor(config?: Partial<VariatorConfig>);
    /**
     * Create a unique variation of a message
     * Each call produces a slightly different version
     */
    vary(text: string): string;
    /**
     * Create N unique variations of a message
     */
    varyBulk(text: string, count: number): string[];
    private addZeroWidth;
    private varyPunctuation;
    private addEmojiPadding;
    private applySynonyms;
    private randomPositions;
}
