/** Holds tool-driven modal UI until command pickers close. */

interface Waiter {
  resolve(ready: boolean): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/** Nested pickers share one active period and release waiters together. */
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

  /** False if aborted before pickers close. */
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

export const modalPriority = new ModalPriority();
