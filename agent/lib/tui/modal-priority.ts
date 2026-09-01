/** Coordinates command overlays with tool-driven modal UI. */

interface Waiter {
  resolve(ready: boolean): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Tracks command overlays that must finish before tool-driven modal UI mounts.
 * Nested overlays share one active period and release all waiters at the end.
 */
export class ModalPriority {
  private active = 0;
  private readonly waiters = new Set<Waiter>();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
      if (this.active === 0) this.releaseWaiters();
    }
  }

  /** Returns false if the caller is aborted before command overlays close. */
  wait(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) return Promise.resolve(false);
    if (this.active === 0) return Promise.resolve(true);

    return new Promise((resolve) => {
      const waiter: Waiter = { resolve, signal };
      if (signal) {
        waiter.onAbort = () => {
          this.waiters.delete(waiter);
          resolve(false);
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }

  private releaseWaiters(): void {
    for (const waiter of this.waiters) {
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve(true);
    }
    this.waiters.clear();
  }
}

/** Shared coordination point for all local extensions. */
export const modalPriority = new ModalPriority();
