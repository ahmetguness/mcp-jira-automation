/**
 * Result Extractor for Docker Test Execution
 * 
 * Extracts test results from completed Docker containers, including:
 * - stdout and stderr logs
 * - Exit codes
 * - Execution duration
 * - Docker metadata
 */

import Docker from 'dockerode';
import type { ResultExtractor, DockerRawTestResult } from './types.js';
import type { TestFramework } from '../types.js';
import { ResultExtractionError } from './errors.js';
import { createLogger } from '../../logger.js';

const log = createLogger('docker:result-extractor');

// Maximum log size before truncation (10MB)
const MAX_LOG_SIZE = 10 * 1024 * 1024;

/**
 * Default implementation of ResultExtractor using dockerode
 */
export class DefaultResultExtractor implements ResultExtractor {
  private docker: Docker;

  constructor(docker?: Docker) {
    this.docker = docker ?? new Docker();
  }

  /**
   * Extract test results from a completed container
   */
  async extractResults(
    containerId: string,
    startTime: number,
    framework: TestFramework
  ): Promise<DockerRawTestResult> {
    try {
      log.debug('Extracting results from container', { containerId, framework });

      // Capture logs
      const { stdout, stderr } = await this.captureLogs(containerId);
      log.debug('Logs captured', {
        containerId,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });

      // Get exit code
      const exitCode = await this.getExitCode(containerId);
      log.debug('Exit code retrieved', { containerId, exitCode });

      // Get container inspection for timestamps
      const container = this.docker.getContainer(containerId);
      const inspection = await container.inspect();

      // Calculate timestamps
      const containerCreationTime = new Date(inspection.Created).getTime();
      const containerStartTime = new Date(inspection.State.StartedAt).getTime();
      const containerStopTime = new Date(inspection.State.FinishedAt).getTime();

      // Calculate execution duration (from start to stop)
      const duration = containerStopTime - containerStartTime;

      // Determine if execution timed out
      const timedOut = false; // Timeout is handled by waitForContainer throwing an error

      log.info('Results extracted successfully', {
        containerId,
        exitCode,
        duration,
        imageName: inspection.Config.Image,
        networkMode: inspection.HostConfig.NetworkMode,
      });

      // Build result
      const result: DockerRawTestResult = {
        stdout,
        stderr,
        exitCode,
        duration,
        framework,
        timestamp: startTime,
        timedOut,
        docker: {
          containerId,
          imageName: inspection.Config.Image,
          networkMode: inspection.HostConfig.NetworkMode ?? 'none',
          containerCreationTime,
          containerStartTime,
          containerStopTime,
        },
      };

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to extract results', {
        containerId,
        error: errorMessage,
      });
      
      throw new ResultExtractionError(
        `Failed to extract results from container ${containerId}: ${errorMessage}`,
        containerId,
        'inspect'
      );
    }
  }

  /**
   * Capture container logs (stdout and stderr)
   */
  async captureLogs(containerId: string): Promise<{ stdout: string; stderr: string }> {
    try {
      log.debug('Capturing logs from container', { containerId });
      const container = this.docker.getContainer(containerId);

      // Get logs with both stdout and stderr
      const logsStream = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
      });

      // Docker logs use a multiplexed stream format
      // Each frame has an 8-byte header: [stream_type, 0, 0, 0, size1, size2, size3, size4]
      // stream_type: 1=stdout, 2=stderr
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      if (Buffer.isBuffer(logsStream)) {
        let offset = 0;
        while (offset < logsStream.length) {
          // Read header (8 bytes)
          if (offset + 8 > logsStream.length) break;
          
          const streamType = logsStream[offset];
          const size = logsStream.readUInt32BE(offset + 4);
          
          // Read payload
          const payloadStart = offset + 8;
          const payloadEnd = payloadStart + size;
          
          if (payloadEnd > logsStream.length) break;
          
          const payload = logsStream.slice(payloadStart, payloadEnd);
          
          // Route to stdout or stderr based on stream type
          if (streamType === 1) {
            stdout.push(payload);
          } else if (streamType === 2) {
            stderr.push(payload);
          }
          
          offset = payloadEnd;
        }
      }

      // Convert buffers to strings
      let stdoutStr = Buffer.concat(stdout).toString('utf-8');
      let stderrStr = Buffer.concat(stderr).toString('utf-8');

      // Handle log truncation for large outputs
      if (stdoutStr.length > MAX_LOG_SIZE) {
        log.warn('stdout truncated due to size limit', {
          containerId,
          originalSize: stdoutStr.length,
          truncatedSize: MAX_LOG_SIZE,
        });
        stdoutStr = stdoutStr.substring(0, MAX_LOG_SIZE) + '\n\n[... truncated: output too large]';
      }

      if (stderrStr.length > MAX_LOG_SIZE) {
        log.warn('stderr truncated due to size limit', {
          containerId,
          originalSize: stderrStr.length,
          truncatedSize: MAX_LOG_SIZE,
        });
        stderrStr = stderrStr.substring(0, MAX_LOG_SIZE) + '\n\n[... truncated: output too large]';
      }

      log.debug('Logs captured successfully', {
        containerId,
        stdoutLength: stdoutStr.length,
        stderrLength: stderrStr.length,
      });

      return { stdout: stdoutStr, stderr: stderrStr };
    } catch (error) {
      // Handle error more robustly
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      } else if (error && typeof error === 'object') {
        errorMessage = JSON.stringify(error);
      }
      
      log.error('Failed to capture logs', {
        containerId,
        error: errorMessage,
      });
      
      throw new ResultExtractionError(
        `Failed to capture logs from container ${containerId}: ${errorMessage}`,
        containerId,
        'logs'
      );
    }
  }

  /**
   * Get container exit code
   */
  async getExitCode(containerId: string): Promise<number> {
    try {
      log.debug('Getting exit code from container', { containerId });
      const container = this.docker.getContainer(containerId);
      const inspection = await container.inspect();

      // Exit code is in State.ExitCode
      const exitCode = inspection.State.ExitCode;

      // If exit code is undefined or null, default to 1 (failure)
      if (exitCode === undefined || exitCode === null) {
        log.warn('Exit code unavailable, defaulting to 1', {
          containerId,
        });
        return 1;
      }

      log.debug('Exit code retrieved', { containerId, exitCode });
      return exitCode;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to get exit code', {
        containerId,
        error: errorMessage,
      });
      
      throw new ResultExtractionError(
        `Failed to get exit code from container ${containerId}: ${errorMessage}`,
        containerId,
        'exit_code'
      );
    }
  }
}
