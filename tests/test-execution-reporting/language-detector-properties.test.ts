/**
 * Property-based tests for Language Detector component
 * Feature: test-execution-reporting, Property 4: Language Detection Accuracy
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { DefaultLanguageDetector } from '../../src/test-execution-reporting/language-detector.js';

describe('Language Detector Properties', () => {
  const detector = new DefaultLanguageDetector();
  const testConfig = { numRuns: 5 }; // Reduced for faster execution

  // Generators for Turkish and English content
  const turkishCharArb = fc.constantFrom('ğ', 'ü', 'ş', 'ı', 'ö', 'ç', 'Ğ', 'Ü', 'Ş', 'İ', 'Ö', 'Ç');
  const turkishWordArb = fc.constantFrom('hata', 'başarılı', 'başarısız', 'çalıştır', 'testler', 'sonuç', 'rapor');
  const englishWordArb = fc.constantFrom('error', 'success', 'failure', 'run', 'tests', 'result', 'report');
  const neutralWordArb = fc.constantFrom('data', 'code', 'file', 'system', 'process', 'value');

  // Generate Turkish-heavy content
  const turkishContentArb = fc.tuple(
    fc.array(turkishCharArb, { minLength: 3, maxLength: 10 }),
    fc.array(turkishWordArb, { minLength: 3, maxLength: 10 }),
    fc.array(neutralWordArb, { minLength: 0, maxLength: 5 })
  ).map(([chars, words, neutral]) => {
    return [...chars, ...words, ...neutral].join(' ');
  });

  // Generate English-heavy content
  const englishContentArb = fc.tuple(
    fc.array(englishWordArb, { minLength: 5, maxLength: 15 }),
    fc.array(neutralWordArb, { minLength: 0, maxLength: 5 })
  ).map(([words, neutral]) => {
    return [...words, ...neutral].join(' ');
  });

  // Generate ambiguous content (low indicator count)
  const ambiguousContentArb = fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.array(neutralWordArb, { minLength: 1, maxLength: 5 }).map(words => words.join(' ')),
    fc.string().filter(s => !/[ğüşıöçĞÜŞİÖÇ]/.test(s) && s.length < 20)
  );

  // Feature: test-execution-reporting, Property 4: Language Detection Accuracy
  describe('Property 4: Language Detection Accuracy', () => {
    it('should detect Turkish for content with Turkish-specific characters', () => {
      fc.assert(
        fc.property(turkishContentArb, (content) => {
          const result = detector.detect(content);
          // Turkish content should be detected as Turkish
          return result === 'tr';
        }),
        testConfig
      );
    });

    it('should detect English for content with English keywords', () => {
      fc.assert(
        fc.property(englishContentArb, (content) => {
          const result = detector.detect(content);
          // English content should be detected as English
          return result === 'en';
        }),
        testConfig
      );
    });

    it('should default to English for ambiguous or empty content', () => {
      fc.assert(
        fc.property(ambiguousContentArb, (content) => {
          const result = detector.detect(content);
          // Ambiguous content should default to English
          return result === 'en';
        }),
        testConfig
      );
    });

    it('should always return a valid language code', () => {
      fc.assert(
        fc.property(fc.string(), (content) => {
          const result = detector.detect(content);
          // Result must be either 'tr' or 'en'
          return result === 'tr' || result === 'en';
        }),
        testConfig
      );
    });

    it('should be deterministic for the same input', () => {
      fc.assert(
        fc.property(fc.string(), (content) => {
          const result1 = detector.detect(content);
          const result2 = detector.detect(content);
          // Same input should always produce same output
          return result1 === result2;
        }),
        testConfig
      );
    });

    it('should handle case-insensitive matching', () => {
      fc.assert(
        fc.property(turkishWordArb, (word) => {
          const lowercase = detector.detect(word.repeat(5));
          const uppercase = detector.detect(word.toUpperCase().repeat(5));
          const mixed = detector.detect(
            (word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).repeat(5)
          );
          // Case variations should produce same result
          return lowercase === uppercase && uppercase === mixed;
        }),
        testConfig
      );
    });

    it('should detect Turkish when Turkish indicators exceed English by 3+', () => {
      fc.assert(
        fc.property(
          fc.array(turkishCharArb, { minLength: 6, maxLength: 10 }),
          fc.array(englishWordArb, { minLength: 0, maxLength: 2 }),
          (turkishChars, englishWords) => {
            const content = [...turkishChars, ...englishWords].join(' ');
            const result = detector.detect(content);
            // Turkish should dominate when it has more than 3 more indicators
            // Min 6 Turkish chars, max 2 English words = difference of at least 4
            return result === 'tr';
          }
        ),
        testConfig
      );
    });

    it('should detect English when English indicators exceed Turkish by 3+', () => {
      fc.assert(
        fc.property(
          fc.array(englishWordArb, { minLength: 5, maxLength: 10 }),
          (englishWords) => {
            const content = englishWords.join(' ');
            const result = detector.detect(content);
            // English should dominate when it has 3+ more indicators
            return result === 'en';
          }
        ),
        testConfig
      );
    });

    it('should handle very long content efficiently', () => {
      fc.assert(
        fc.property(
          fc.oneof(turkishContentArb, englishContentArb),
          fc.integer({ min: 10, max: 100 }),
          (content, repeatCount) => {
            const longContent = content.repeat(repeatCount);
            const startTime = Date.now();
            const result = detector.detect(longContent);
            const duration = Date.now() - startTime;
            // Should complete in reasonable time (< 100ms) and return valid result
            return duration < 100 && (result === 'tr' || result === 'en');
          }
        ),
        testConfig
      );
    });

    it('should handle content with special characters and numbers', () => {
      fc.assert(
        fc.property(
          turkishContentArb,
          fc.string({ minLength: 0, maxLength: 20 }),
          (turkishContent, noise) => {
            const content = turkishContent + ' ' + noise + ' 123 @#$ 456';
            const result = detector.detect(content);
            // Turkish indicators should still be detected despite noise
            return result === 'tr';
          }
        ),
        testConfig
      );
    });
  });
});
