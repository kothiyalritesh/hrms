/**
 * Startup timing and diagnostic instrumentation.
 * Tracks performance checkpoints:
 * Native Shell -> WebView Load -> JS Ready -> Cached Session -> Token Refresh -> Profile RPC -> Dashboard Painted
 */

const STARTUP_ORIGIN = Date.now();
const checkpoints = new Map<string, number>();

export function markStartupCheckpoint(name: string, extra?: Record<string, unknown>) {
  const now = Date.now();
  checkpoints.set(name, now);
  const totalElapsed = now - STARTUP_ORIGIN;
  const extraStr = extra ? ` | ${JSON.stringify(extra)}` : "";
  console.log(`[StartupTiming] ${name} +${totalElapsed}ms${extraStr}`);
}

export function getStartupElapsed(name?: string): number {
  if (!name) return Date.now() - STARTUP_ORIGIN;
  const checkpointTime = checkpoints.get(name);
  return checkpointTime ? Date.now() - checkpointTime : Date.now() - STARTUP_ORIGIN;
}

