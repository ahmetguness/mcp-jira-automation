/**
 * Turkish language template for test execution reports
 */

import type { ReportTemplate } from './en.js';

export const turkishTemplate: ReportTemplate = {
  header: '# Test Çalıştırma Raporu',
  executionTime: '**Çalıştırma Zamanı**',
  duration: '**Süre**',
  summaryHeader: '## Özet',
  totalTests: '**Toplam Test**',
  passed: '**Başarılı**',
  failed: '**Başarısız**',
  skipped: '**Atlandı**',
  successRate: '**Başarı Oranı**',
  testResultsHeader: '## Test Sonuçları',
  passedTestsHeader: '### Başarılı Testler',
  failedTestsHeader: '### Başarısız Testler',
  skippedTestsHeader: '### Atlanan Testler',
  errorsHeader: '## Hatalar',
  noErrors: 'Test çalıştırma sırasında hata oluşmadı.',
  syntaxError: '⚠️ **Sözdizimi Hatası**',
  dependencyError: '⚠️ **Bağımlılık Hatası**',
  timeoutError: '⚠️ **Zaman Aşımı Hatası**',
  runtimeError: '⚠️ **Çalışma Zamanı Hatası**',
  stackTrace: 'Hata İzleme',
  missingDependencies: 'Eksik Bağımlılıklar',
  executionDuration: 'Çalıştırma Süresi',
  errorDetails: 'Hata Detayları',
  dockerMetadataHeader: '## Docker Çalıştırma Bilgileri',
  dockerContainerId: '**Konteyner ID**',
  dockerImageName: '**İmaj Adı**',
  dockerNetworkMode: '**Ağ Modu**',
};
