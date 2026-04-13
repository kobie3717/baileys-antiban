/**
 * Content Variator — Auto-vary messages to avoid spam detection
 *
 * WhatsApp flags identical messages sent to multiple recipients.
 * This module adds invisible variations so each message is technically unique.
 */
const DEFAULT_CONFIG = {
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
const SYNONYMS = {
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
    config;
    counter = 0;
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    /**
     * Create a unique variation of a message
     * Each call produces a slightly different version
     */
    vary(text) {
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
    varyBulk(text, count) {
        const results = [];
        const seen = new Set();
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
    addZeroWidth(text) {
        const words = text.split(' ');
        if (words.length < 2)
            return text;
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
    varyPunctuation(text) {
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
    addEmojiPadding(text) {
        const emojis = ['', ' 👍', ' ✅', ' 📌', ' 💬', ' 📢'];
        return text + emojis[this.counter % emojis.length];
    }
    applySynonyms(text) {
        const words = text.split(/\b/);
        let replaced = false;
        return words.map(word => {
            if (replaced)
                return word;
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
    randomPositions(max, count) {
        const positions = [];
        while (positions.length < count) {
            const pos = Math.floor(Math.random() * max);
            if (!positions.includes(pos))
                positions.push(pos);
        }
        return positions;
    }
}
