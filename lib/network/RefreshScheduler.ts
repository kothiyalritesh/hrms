import { AppState, AppStateStatus } from "react-native";

export interface RefreshSubscriber {
  key: string;
  callback: () => Promise<void> | void;
  fallbackIntervalMs: number;
  requiresFocus?: boolean;
  isFocused?: boolean;
}

class RefreshSchedulerClass {
  private subscribers = new Map<string, RefreshSubscriber>();
  private timers = new Map<string, any>();
  private debounceTimers = new Map<string, any>();
  private isRealtimeHealthy = false;
  private isAppActive = true;
  private lastActiveTimestamp = Date.now();
  private appStateSubscription: any = null;

  constructor() {
    this.initAppStateListener();
  }

  private initAppStateListener() {
    this.appStateSubscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const wasActive = this.isAppActive;
      this.isAppActive = nextState === "active";

      if (this.isAppActive && !wasActive) {
        const inactiveDuration = Date.now() - this.lastActiveTimestamp;
        // If returning to foreground after >30 seconds, trigger revalidation
        if (inactiveDuration > 30_000) {
          if (__DEV__) {
            console.log(
              `[RefreshScheduler] App returned to active after ${Math.round(inactiveDuration / 1000)}s. Triggering revalidation.`
            );
          }
          this.triggerAllActive();
        }
        this.rescheduleAll();
      } else if (!this.isAppActive) {
        this.lastActiveTimestamp = Date.now();
        // Stop all timers when backgrounded
        this.clearAllTimers();
      }
    });
  }

  /**
   * Set realtime health status. When healthy, routine polling is suspended.
   */
  public setRealtimeHealthy(healthy: boolean): void {
    if (this.isRealtimeHealthy !== healthy) {
      this.isRealtimeHealthy = healthy;
      if (__DEV__) {
        console.log(
          `[RefreshScheduler] Realtime health changed: healthy=${healthy}. Rescheduling polling.`
        );
      }
      this.rescheduleAll();
    }
  }

  /**
   * Register a resource refresh listener with a fallback interval.
   */
  public register(
    key: string,
    callback: () => Promise<void> | void,
    options?: {
      fallbackIntervalMs?: number;
      requiresFocus?: boolean;
      isFocused?: boolean;
    }
  ): void {
    const subscriber: RefreshSubscriber = {
      key,
      callback,
      fallbackIntervalMs: options?.fallbackIntervalMs ?? 60_000,
      requiresFocus: options?.requiresFocus ?? true,
      isFocused: options?.isFocused ?? true,
    };

    this.subscribers.set(key, subscriber);
    this.scheduleSubscriber(subscriber);
  }

  /**
   * Update focus state for a registered screen subscriber.
   */
  public setSubscriberFocus(key: string, isFocused: boolean): void {
    const subscriber = this.subscribers.get(key);
    if (subscriber) {
      subscriber.isFocused = isFocused;
      if (isFocused) {
        this.scheduleSubscriber(subscriber);
      } else {
        this.clearTimer(key);
      }
    }
  }

  /**
   * Unregister a refresh listener when component unmounts.
   */
  public unregister(key: string): void {
    this.subscribers.delete(key);
    this.clearTimer(key);
    this.clearDebounce(key);
  }

  /**
   * Debounce a trigger. If 10 events fire within delayMs (default 500ms),
   * coalesce into a SINGLE execution.
   */
  public debounceTrigger(key: string, delayMs: number = 500): void {
    this.clearDebounce(key);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(key);
      const sub = this.subscribers.get(key);
      if (sub && (!sub.requiresFocus || sub.isFocused)) {
        if (__DEV__) {
          console.log(`[RefreshScheduler] Executing debounced refresh for ${key}`);
        }
        void sub.callback();
      }
    }, delayMs);
    this.debounceTimers.set(key, timer);
  }

  private scheduleSubscriber(sub: RefreshSubscriber): void {
    this.clearTimer(sub.key);

    // Rule: App in background -> NO polling
    if (!this.isAppActive) return;

    // Rule: Screen unfocused when focus required -> NO polling
    if (sub.requiresFocus && !sub.isFocused) return;

    // Rule: Realtime healthy -> NO routine polling (fallback every 10 minutes max for consistency)
    const effectiveInterval = this.isRealtimeHealthy
      ? 10 * 60 * 1000 // 10 minutes consistency check
      : sub.fallbackIntervalMs;

    const timer = setInterval(() => {
      if (!this.isAppActive) return;
      if (sub.requiresFocus && !sub.isFocused) return;

      if (__DEV__) {
        console.log(
          `[RefreshScheduler] Polling timer triggered for ${sub.key} (interval=${effectiveInterval}ms, realtimeHealthy=${this.isRealtimeHealthy})`
        );
      }
      void sub.callback();
    }, effectiveInterval);

    this.timers.set(sub.key, timer);
  }

  private rescheduleAll(): void {
    for (const sub of this.subscribers.values()) {
      this.scheduleSubscriber(sub);
    }
  }

  private triggerAllActive(): void {
    for (const sub of this.subscribers.values()) {
      if (!sub.requiresFocus || sub.isFocused) {
        void sub.callback();
      }
    }
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(key);
    }
  }

  private clearDebounce(key: string): void {
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}

export const RefreshScheduler = new RefreshSchedulerClass();

