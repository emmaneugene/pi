import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ModalPriority, modalPriority } from "../tui/modal-priority.ts";
import { showCatalog } from "../tui/picker.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("ModalPriority", () => {
  it("lets modal UI proceed when no command overlay is active", async () => {
    const priority = new ModalPriority();

    await expect(priority.wait()).resolves.toBe(true);
  });

  it("holds modal UI until the command overlay closes", async () => {
    const priority = new ModalPriority();
    const overlay = deferred<void>();
    const run = priority.run(() => overlay.promise);
    const ready = vi.fn();
    const waiting = priority.wait().then(ready);

    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();

    overlay.resolve();
    await run;
    await waiting;
    expect(ready).toHaveBeenCalledWith(true);
  });

  it("waits for all nested command overlays", async () => {
    const priority = new ModalPriority();
    const outer = deferred<void>();
    const inner = deferred<void>();
    const outerRun = priority.run(() => outer.promise);
    const innerRun = priority.run(() => inner.promise);
    const ready = vi.fn();
    const waiting = priority.wait().then(ready);

    outer.resolve();
    await outerRun;
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();

    inner.resolve();
    await innerRun;
    await waiting;
    expect(ready).toHaveBeenCalledWith(true);
  });

  it("releases the priority after an overlay throws", async () => {
    const priority = new ModalPriority();

    await expect(
      priority.run(async () => {
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");
    await expect(priority.wait()).resolves.toBe(true);
  });

  it("stops waiting when the tool call is aborted", async () => {
    const priority = new ModalPriority();
    const overlay = deferred<void>();
    const run = priority.run(() => overlay.promise);
    const controller = new AbortController();
    const waiting = priority.wait(controller.signal);

    controller.abort();

    await expect(waiting).resolves.toBe(false);
    overlay.resolve();
    await run;
  });

  it("treats the full shared catalog flow as modal-priority work", async () => {
    const mounted = deferred<void>();
    const close = deferred<undefined>();
    const ctx = {
      mode: "tui",
      ui: {
        custom: () => {
          mounted.resolve();
          return close.promise;
        },
        notify: vi.fn(),
      },
    } as unknown as ExtensionContext;
    const catalog = showCatalog(ctx, "Things", [
      {
        item: { label: "one", value: "one" },
        artifact: () => ({ content: "one" }),
      },
    ]);
    await mounted.promise;
    const ready = vi.fn();
    const waiting = modalPriority.wait().then(ready);

    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();

    close.resolve(undefined);
    await catalog;
    await waiting;
    expect(ready).toHaveBeenCalledWith(true);
  });
});
