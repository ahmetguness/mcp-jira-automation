/**
 * Unit tests for Language Detector component
 */

import { describe, it, expect } from 'vitest';
import { DefaultLanguageDetector } from '../../src/test-execution-reporting/language-detector.js';

describe('DefaultLanguageDetector', () => {
  const detector = new DefaultLanguageDetector();

  describe('Turkish detection', () => {
    it('should detect Turkish from Turkish-specific characters', () => {
      const content = 'Bu bir test açıklaması. Şu anda çalışıyor.';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should detect Turkish from Turkish words', () => {
      const content = 'Test başarılı oldu. Hata yok.';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should detect Turkish from mixed characters and words', () => {
      const content = 'Testler çalıştırıldı ve başarısız oldu. Hata raporu oluşturuldu.';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should detect Turkish with uppercase characters', () => {
      const content = 'BAŞARILI TEST ÇALIŞTIRMA';
      expect(detector.detect(content)).toBe('tr');
    });
  });

  describe('English detection', () => {
    it('should detect English from English words', () => {
      const content = 'Test execution was successful. No errors found.';
      expect(detector.detect(content)).toBe('en');
    });

    it('should detect English from test-related keywords', () => {
      const content = 'Run tests and check for failures. Generate report on success.';
      expect(detector.detect(content)).toBe('en');
    });

    it('should detect English with uppercase words', () => {
      const content = 'TEST EXECUTION SUCCESS REPORT';
      expect(detector.detect(content)).toBe('en');
    });
  });

  describe('Ambiguous content', () => {
    it('should default to English for empty content', () => {
      expect(detector.detect('')).toBe('en');
    });

    it('should default to English for whitespace-only content', () => {
      expect(detector.detect('   \n\t  ')).toBe('en');
    });

    it('should default to English when score difference is less than 3', () => {
      const content = 'test test';
      expect(detector.detect(content)).toBe('en');
    });

    it('should default to English for content with no language indicators', () => {
      const content = '12345 @#$% xyz abc';
      expect(detector.detect(content)).toBe('en');
    });
  });

  describe('Mixed content', () => {
    it('should detect Turkish when Turkish indicators dominate', () => {
      const content = 'Test başarılı. Çalıştır. Some English words here.';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should detect English when English indicators dominate', () => {
      const content = 'Test success. Run error check. Bir iki test.';
      expect(detector.detect(content)).toBe('en');
    });
  });

  describe('Edge cases', () => {
    it('should handle very long content', () => {
      const turkishContent = 'Başarılı test çalıştırma. '.repeat(100);
      expect(detector.detect(turkishContent)).toBe('tr');
    });

    it('should handle content with special characters', () => {
      const content = 'Test başarılı! @#$% Çalıştır... Hata?';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should handle content with numbers', () => {
      const content = 'Test 123 başarılı 456 çalıştır 789';
      expect(detector.detect(content)).toBe('tr');
    });

    it('should be case-insensitive for word matching', () => {
      const content = 'ERROR ERROR ERROR SUCCESS FAILURE';
      expect(detector.detect(content)).toBe('en');
    });
  });

  describe('Real-world Jira task examples', () => {
    it('should detect Turkish from typical Turkish Jira task', () => {
      const content = `
        Görev: Test dosyalarını otomatik çalıştır
        
        Açıklama:
        AI Cyber Bot test dosyaları oluşturduğunda, bu testlerin otomatik olarak 
        çalıştırılması ve sonuçların raporlanması gerekiyor.
        
        Kabul Kriterleri:
        - Testler başarılı şekilde çalıştırılmalı
        - Hata durumunda detaylı rapor oluşturulmalı
        - Sonuçlar PR'a eklenmeliş
      `;
      expect(detector.detect(content)).toBe('tr');
    });

    it('should detect English from typical English Jira task', () => {
      const content = `
        Task: Automatically execute test files
        
        Description:
        When AI Cyber Bot creates test files, these tests should be automatically
        executed and results should be reported.
        
        Acceptance Criteria:
        - Tests should run successfully
        - Detailed report should be generated on error
        - Results should be added to PR
      `;
      expect(detector.detect(content)).toBe('en');
    });
  });
});
