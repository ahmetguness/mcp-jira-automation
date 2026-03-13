import type { PRUpdater, UpdateOptions, ReportLanguage } from './types.js';
import type { ScmProvider } from '../scm/provider.js';
import { createLogger } from '../logger.js';

const log = createLogger('test-execution-reporting:pr-updater');

export class DefaultPRUpdater implements PRUpdater {
  constructor(
    private scmProvider: ScmProvider,
    private language: ReportLanguage = 'en'
  ) {}

  async addReport(prUrl: string, report: string, options: UpdateOptions): Promise<boolean> {
    const { repo, branch } = this.parsePrUrl(prUrl);
    const timestamp = this.generateTimestamp();
    const filename = `test-report-${timestamp}.md`;
    const commitMessage = this.getCommitMessage();

    let lastError: Error | null = null;
    const maxRetries = options.maxRetries;
    const baseDelay = options.retryDelay;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const delay = attempt * baseDelay;
        if (delay > 0) {
          await this.sleep(delay);
        }

        await this.scmProvider.writeFile(repo, filename, report, commitMessage, branch);

        log.info(`Successfully committed test report: ${filename} to ${repo}/${branch}`);
        return true;
      } catch (err) {
        lastError = err as Error;
        const errorType = this.categorizeError(err);

        log.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${errorType} - ${lastError.message}`);

        if (errorType === 'permission') {
          log.error(`Permission error - not retrying: ${lastError.message}`);
          return false;
        }

        if (errorType === 'rate_limit' && attempt < maxRetries - 1) {
          const rateLimitDelay = 5000;
          log.info(`Rate limit hit, waiting ${rateLimitDelay}ms before retry`);
          await this.sleep(rateLimitDelay);
        }

        if (errorType === 'conflict' && attempt < maxRetries - 1) {
          log.info('Conflict detected, retrying...');
        }
      }
    }

    log.error(`Failed to commit test report after ${maxRetries} attempts: ${lastError?.message}`);
    return false;
  }

  private parsePrUrl(prUrl: string): { repo: string; branch: string } {
    try {
      const url = new URL(prUrl);
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (url.hostname.includes('github.com')) {
        if (pathParts.length >= 2) {
          const repo = `/${pathParts[1]}`;
          const branch = 'main';
          return { repo, branch };
        }
      } else if (url.hostname.includes('gitlab.com')) {
        if (pathParts.length >= 2) {
          const repo = `/${pathParts[1]}`;
          const branch = 'main';
          return { repo, branch };
        }
      } else if (url.hostname.includes('bitbucket.org')) {
        if (pathParts.length >= 2) {
          const repo = `/${pathParts[1]}`;
          const branch = 'main';
          return { repo, branch };
        }
      }
    } catch (err) {
      throw new Error(`Invalid PR URL: ${prUrl}`, { cause: err });
    }

    throw new Error(`Unable to parse PR URL: ${prUrl}`);
  }

  private generateTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const millis = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}${millis}`;
  }

  private getCommitMessage(): string {
    return this.language === 'tr'
      ? 'Test çalıştırma raporu eklendi'
      : 'Add test execution report';
  }

  private categorizeError(error: unknown): 'network' | 'permission' | 'rate_limit' | 'conflict' | 'unknown' {
    if (!error) return 'unknown';

    let errorMessage: string;
    if (error instanceof Error) {
      errorMessage = error.message.toLowerCase();
    } else if (typeof error === 'string') {
      errorMessage = error.toLowerCase();
    } else if (typeof error === 'number' || typeof error === 'boolean') {
      errorMessage = String(error).toLowerCase();
    } else if (typeof error === 'object' && error !== null) {
      // Try to extract meaningful information from the error object
      const errorObj = error as Record<string, unknown>;
      if ('message' in errorObj && typeof errorObj.message === 'string') {
        errorMessage = errorObj.message.toLowerCase();
      } else if ('statusCode' in errorObj) {
        errorMessage = String(errorObj.statusCode).toLowerCase();
      } else if ('code' in errorObj && typeof errorObj.code === 'string') {
        errorMessage = errorObj.code.toLowerCase();
      } else {
        // Fallback to empty string if we can't extract meaningful info
        errorMessage = '';
      }
    } else {
      // For any other type, use empty string
      errorMessage = '';
    }

    if (errorMessage.includes('403') || errorMessage.includes('401') || errorMessage.includes('permission') || errorMessage.includes('unauthorized') || errorMessage.includes('forbidden')) {
      return 'permission';
    }

    if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
      return 'rate_limit';
    }

    if (errorMessage.includes('409') || errorMessage.includes('conflict')) {
      return 'conflict';
    }

    if (errorMessage.includes('network') || errorMessage.includes('econnrefused') || errorMessage.includes('enotfound') || errorMessage.includes('timeout')) {
      return 'network';
    }

    return 'unknown';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
