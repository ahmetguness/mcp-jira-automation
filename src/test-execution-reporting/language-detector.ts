/**
 * Language Detector component for Test Execution Reporting
 * Analyzes Jira task content to determine report language (Turkish or English)
 */

import type { LanguageDetector, ReportLanguage } from './types.js';

/**
 * Language detection heuristics and scoring
 */
interface LanguageScore {
  turkish: number;
  english: number;
}

/**
 * Default implementation of Language Detector
 */
export class DefaultLanguageDetector implements LanguageDetector {
  // Turkish-specific characters (including both lowercase and uppercase)
  private readonly turkishChars = /[ğüşıöçĞÜŞİÖÇ]/g;

  // Turkish test-related words (case-insensitive)
  private readonly turkishWords = [
    'hata',
    'başarılı',
    'başarısız',
    'çalıştır',
    'testler',
    'sonuç',
    'rapor',
  ];

  // English test-related words (case-insensitive)
  private readonly englishWords = [
    'error',
    'success',
    'failure',
    'run',
    'tests',
    'result',
    'report',
  ];

  // Minimum score difference to confidently determine language
  private readonly minScoreDifference = 3;

  /**
   * Detect language from Jira task content
   * @param taskContent - Jira task description and comments
   * @returns Detected language code ('tr' or 'en')
   */
  detect(taskContent: string): ReportLanguage {
    // Default to English for empty or whitespace-only content
    if (!taskContent || taskContent.trim().length === 0) {
      return 'en';
    }

    const scores = this.calculateLanguageScores(taskContent);

    // If Turkish exceeds English by threshold, return Turkish
    if (scores.turkish - scores.english >= this.minScoreDifference) {
      return 'tr';
    }

    // If English exceeds Turkish by threshold, return English
    if (scores.english - scores.turkish >= this.minScoreDifference) {
      return 'en';
    }

    // If difference is too small, default to English
    return 'en';
  }

  /**
   * Calculate language indicator scores
   * @param content - Content to analyze
   * @returns Language scores
   */
  private calculateLanguageScores(content: string): LanguageScore {
    const lowerContent = content.toLowerCase();

    // Count Turkish indicators
    const turkishCharMatches = content.match(this.turkishChars);
    const turkishCharCount = turkishCharMatches ? turkishCharMatches.length : 0;

    const turkishWordCount = this.turkishWords.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = lowerContent.match(regex);
      return count + (matches ? matches.length : 0);
    }, 0);

    // Count English indicators
    const englishWordCount = this.englishWords.reduce((count, word) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = lowerContent.match(regex);
      return count + (matches ? matches.length : 0);
    }, 0);

    return {
      turkish: turkishCharCount + turkishWordCount,
      english: englishWordCount,
    };
  }
}
