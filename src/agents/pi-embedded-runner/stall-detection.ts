/**
 * Stall Detection for LLM API requests
 *
 * Detects when an API request is hanging (likely due to rate limiting)
 * rather than actively processing, using:
 * 1. Idle timeout - abort if no streaming events for X seconds
 * 2. Parallel API ping - verify API is responsive when idle detected
 *
 * Google Antigravity tends to hang silently on rate limits instead of
 * returning a 429 error, causing long waits. This module detects that
 * condition quickly.
 */

import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("agent/stall-detection");

export interface StallDetectionConfig {
  /** Time to wait for first streaming event (ms). Default: 15000 */
  firstEventTimeoutMs?: number;
  /** Time without streaming events before checking for stall (ms). Default: 10000 */
  idleTimeoutMs?: number;
  /** Timeout for health probe request (ms). Default: 5000 */
  probeTimeoutMs?: number;
  /** If probe responds faster than this, API is responsive but main request is stalled (ms). Default: 3000 */
  probeResponsiveThresholdMs?: number;
}

export interface StallDetector {
  /** Call this when any streaming event is received */
  onActivity(): void;
  /** Call this when the request completes (success or error) */
  dispose(): void;
  /** Returns true if a stall was detected */
  isStalled(): boolean;
}

export interface StallDetectorParams {
  config?: StallDetectionConfig;
  provider: string;
  /** Called when a stall is detected - should abort the request */
  onStallDetected: (reason: string) => void;
  /** Function to probe API health - should return quickly if API is responsive */
  probeHealth?: () => Promise<{ responsive: boolean; latencyMs: number }>;
}

const DEFAULT_CONFIG: Required<StallDetectionConfig> = {
  firstEventTimeoutMs: 15_000,
  idleTimeoutMs: 10_000,
  probeTimeoutMs: 5_000,
  probeResponsiveThresholdMs: 3_000,
};

/**
 * Creates a stall detector for an LLM request.
 *
 * Usage:
 * ```ts
 * const detector = createStallDetector({
 *   provider: "google-antigravity",
 *   onStallDetected: (reason) => abortRun(true),
 *   probeHealth: () => probeGoogleHealth(authToken),
 * });
 *
 * // In your event handler:
 * session.on("event", () => detector.onActivity());
 *
 * // When done:
 * detector.dispose();
 * ```
 */
export function createStallDetector(params: StallDetectorParams): StallDetector {
  const config = { ...DEFAULT_CONFIG, ...params.config };
  let disposed = false;
  let stalled = false;
  let receivedFirstEvent = false;
  let lastActivityAt = Date.now();
  let idleCheckTimer: NodeJS.Timeout | null = null;
  let firstEventTimer: NodeJS.Timeout | null = null;
  let probeInFlight = false;

  const clearTimers = () => {
    if (idleCheckTimer) {
      clearTimeout(idleCheckTimer);
      idleCheckTimer = null;
    }
    if (firstEventTimer) {
      clearTimeout(firstEventTimer);
      firstEventTimer = null;
    }
  };

  const scheduleIdleCheck = () => {
    if (disposed || stalled) return;
    if (idleCheckTimer) clearTimeout(idleCheckTimer);

    idleCheckTimer = setTimeout(async () => {
      if (disposed || stalled) return;

      const idleMs = Date.now() - lastActivityAt;
      log.debug(
        `idle check triggered: provider=${params.provider} idleMs=${idleMs} threshold=${config.idleTimeoutMs}`,
      );

      if (idleMs < config.idleTimeoutMs) {
        // Activity happened since timer was set, reschedule
        scheduleIdleCheck();
        return;
      }

      // No activity for idleTimeoutMs - check if API is responsive
      if (params.probeHealth && !probeInFlight) {
        probeInFlight = true;
        try {
          log.debug(`probing API health: provider=${params.provider}`);
          const probeStart = Date.now();
          const result = await Promise.race([
            params.probeHealth(),
            new Promise<{ responsive: false; latencyMs: number }>((resolve) =>
              setTimeout(
                () => resolve({ responsive: false, latencyMs: config.probeTimeoutMs }),
                config.probeTimeoutMs,
              ),
            ),
          ]);
          const probeLatency = Date.now() - probeStart;

          if (disposed || stalled) return;

          if (result.responsive && probeLatency < config.probeResponsiveThresholdMs) {
            // API is responsive but our request is not - likely rate limited/stalled
            stalled = true;
            log.warn(
              `stall detected: provider=${params.provider} probeLatency=${probeLatency}ms (API responsive but request stalled)`,
            );
            params.onStallDetected(
              `API responsive (${probeLatency}ms) but request stalled - likely rate limited`,
            );
          } else {
            // API itself is slow - might be overloaded, give it more time
            log.debug(
              `API slow: provider=${params.provider} probeLatency=${probeLatency}ms responsive=${result.responsive}`,
            );
            scheduleIdleCheck();
          }
        } catch (err) {
          log.debug(`probe failed: provider=${params.provider} error=${err}`);
          // Probe failed - API might be down, let normal timeout handle it
          scheduleIdleCheck();
        } finally {
          probeInFlight = false;
        }
      } else if (!params.probeHealth) {
        // No probe function - just report stall based on idle timeout
        stalled = true;
        log.warn(`stall detected (no probe): provider=${params.provider} idleMs=${idleMs}ms`);
        params.onStallDetected(`No activity for ${idleMs}ms`);
      }
    }, config.idleTimeoutMs);
  };

  // Start first event timer
  firstEventTimer = setTimeout(() => {
    if (disposed || stalled || receivedFirstEvent) return;

    log.warn(
      `first event timeout: provider=${params.provider} timeoutMs=${config.firstEventTimeoutMs}`,
    );

    // No first event received - likely stalled from the start
    if (params.probeHealth) {
      // Try a probe before declaring stall
      scheduleIdleCheck();
    } else {
      stalled = true;
      params.onStallDetected(`No response for ${config.firstEventTimeoutMs}ms`);
    }
  }, config.firstEventTimeoutMs);

  return {
    onActivity() {
      if (disposed || stalled) return;

      lastActivityAt = Date.now();

      if (!receivedFirstEvent) {
        receivedFirstEvent = true;
        if (firstEventTimer) {
          clearTimeout(firstEventTimer);
          firstEventTimer = null;
        }
        log.debug(`first event received: provider=${params.provider}`);
      }

      // Reset/start idle check
      scheduleIdleCheck();
    },

    dispose() {
      disposed = true;
      clearTimers();
    },

    isStalled() {
      return stalled;
    },
  };
}

/**
 * Probe function for Google Antigravity API.
 * Uses the models list endpoint which is fast and doesn't consume tokens.
 */
export async function createGoogleAntigravityProbe(
  authToken: string,
): Promise<() => Promise<{ responsive: boolean; latencyMs: number }>> {
  return async () => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("https://generativelanguage.googleapis.com/v1/models", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      return {
        responsive: response.ok || response.status === 401, // 401 means API is responding
        latencyMs,
      };
    } catch {
      return {
        responsive: false,
        latencyMs: Date.now() - start,
      };
    }
  };
}

/**
 * Probe function for Anthropic API.
 */
export async function createAnthropicProbe(
  apiKey: string,
): Promise<() => Promise<{ responsive: boolean; latencyMs: number }>> {
  return async () => {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      return {
        responsive: response.ok || response.status === 401,
        latencyMs,
      };
    } catch {
      return {
        responsive: false,
        latencyMs: Date.now() - start,
      };
    }
  };
}
