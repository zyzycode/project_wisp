import { performance } from 'node:perf_hooks';
import type { LogEntry } from '../../application/ports/logger.interface';
import { AppLogger } from './app-logger';
import { backendLogPolicy, desktopLogPolicy } from './diagnostic-config';
import { DiagnosticOutput, type DiagnosticRecord, type DiagnosticWritable } from './diagnostic-output';

const EVENTS = new Set(['desktop_starting', 'desktop_started', 'desktop_stopping', 'desktop_startup_failed',
  'desktop_services_initialized', 'ai_connection_ready', 'ai_connection_offline', 'ai_connection_external',
  'ai_connection_unavailable', 'brain_delivery_failed', 'logging_configuration_invalid']);

/** Main-only factory. Backend diagnostics bypass the desktop threshold and Renderer buffer. */
export function createDesktopDiagnostics(env: NodeJS.ProcessEnv, options: {
  readonly output?: DiagnosticWritable;
  readonly now?: () => number;
  readonly publish?: () => void;
} = {}) {
  const output = new DiagnosticOutput(options.output ?? process.stderr);
  const policy = desktopLogPolicy(env.WISP_DESKTOP_LOG_LEVEL);
  const logger = new AppLogger({ level: policy.level, sink: (entry: LogEntry) => {
    if (EVENTS.has(entry.message)) output.write({ source: 'desktop', level: entry.level, event: entry.message });
    options.publish?.();
  } });
  if (policy.invalid || backendLogPolicy(env.WISP_LOG_LEVEL).invalid) logger.warn('IPC', 'logging_configuration_invalid');
  let lastDeliveryFailure = -Infinity;
  return {
    logger,
    backend: (record: DiagnosticRecord) => output.write(record),
    brainDeliveryFailed: () => {
      const now = options.now ? options.now() : performance.now();
      if (now - lastDeliveryFailure < 1000) return;
      lastDeliveryFailure = now;
      logger.warn('IPC', 'brain_delivery_failed');
    },
    dispose: () => output.dispose(),
  };
}
