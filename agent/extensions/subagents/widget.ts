/** Live subagent rows rendered above the prompt editor. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  truncateToWidth,
  type TUI,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { recapLine } from "./recap.ts";
import { type AgentRecord, statusIcon } from "./types.ts";

export const MAX_WIDGET_ROWS = 5;
const SUCCESS_LINGER_MS = 6_000;
const FAILURE_LINGER_MS = 10_000;
const TICK_MS = 250;
const RUNNING_FRAMES = ["·", "•", "●", "•"] as const;

export interface WidgetPalette {
  accent(text: string): string;
  dim(text: string): string;
  error(text: string): string;
}

function paletteOf(theme: Theme): WidgetPalette {
  return {
    accent: (text) => theme.fg("accent", text),
    dim: (text) => theme.fg("dim", text),
    error: (text) => theme.fg("error", text),
  };
}

/** Which rows to draw, and how many were left out. */
export interface WidgetSelection {
  shown: readonly AgentRecord[];
  hidden: number;
}

function isActive(record: AgentRecord): boolean {
  return record.status === "running" || record.status === "queued";
}

function isFailure(record: AgentRecord): boolean {
  return (
    record.status === "error" ||
    record.status === "aborted" ||
    record.status === "stopped"
  );
}

/** A viewer can acknowledge only a failure that has already happened. */
export function acknowledgeSettledFailure(record: AgentRecord): void {
  if (isFailure(record)) record.widgetAcknowledged = true;
}

function needsAttention(record: AgentRecord, now: number): boolean {
  return (
    !record.widgetAcknowledged &&
    isFailure(record) &&
    record.completedAt !== undefined &&
    now - record.completedAt < FAILURE_LINGER_MS
  );
}

function isLingeringSuccess(record: AgentRecord, now: number): boolean {
  if (record.status !== "completed" && record.status !== "steered")
    return false;
  return (
    record.completedAt !== undefined &&
    now - record.completedAt < SUCCESS_LINGER_MS
  );
}

/**
 * The visible rows, most urgent first:
 * - recent failures
 * - live work, oldest first, so existing rows keep their place as new
 *   agents appear
 * - recent successful runs
 */
export function selectWidgetRecords(
  records: readonly AgentRecord[],
  now: number,
  maxRows: number = MAX_WIDGET_ROWS,
): WidgetSelection {
  const attention: AgentRecord[] = [];
  const active: AgentRecord[] = [];
  const lingering: AgentRecord[] = [];
  for (const record of records) {
    if (needsAttention(record, now)) attention.push(record);
    else if (isActive(record)) active.push(record);
    else if (isLingeringSuccess(record, now)) lingering.push(record);
  }
  active.sort((a, b) => a.startedAt - b.startedAt);
  lingering.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const ordered = [...attention, ...active, ...lingering];
  const limit = Math.max(0, maxRows);
  return {
    shown: ordered.slice(0, limit),
    hidden: Math.max(0, ordered.length - limit),
  };
}

/** Elapsed run time, compact enough to sit in a right-hand column. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
}

function elapsedOf(record: AgentRecord, now: number): number {
  return (record.completedAt ?? now) - record.startedAt;
}

function iconOf(record: AgentRecord, frame: number): string {
  if (record.status !== "running") return statusIcon(record.status);
  return RUNNING_FRAMES[frame % RUNNING_FRAMES.length];
}

/** One row: `● description · recap                              1m12s`. */
function rowLine(
  record: AgentRecord,
  palette: WidgetPalette,
  width: number,
  frame: number,
  now: number,
): string {
  const attention = needsAttention(record, now);
  const icon = iconOf(record, frame);
  const label = record.description || record.type;
  const head = `${attention ? palette.error(icon) : palette.accent(icon)} ${
    attention ? palette.error(label) : palette.accent(label)
  }`;
  const age = palette.dim(formatDuration(elapsedOf(record, now)));
  const ageWidth = visibleWidth(age);
  // Reserve the age column plus one space, then spend the rest on the recap.
  const recapBudget = width - visibleWidth(head) - ageWidth - 2;
  const recap =
    recapBudget > 4
      ? ` ${palette.dim(truncateToWidth(`· ${recapLine(record)}`, recapBudget, "…"))}`
      : "";
  const left = `${head}${recap}`;
  const gap = Math.max(1, width - visibleWidth(left) - ageWidth);
  return truncateToWidth(`${left}${" ".repeat(gap)}${age}`, width, "…");
}

/**
 * The rendered widget. Empty when there is nothing in flight, which is the
 * signal for the owner to remove it entirely.
 */
export function widgetLines(
  selection: WidgetSelection,
  palette: WidgetPalette,
  options: { width: number; frame: number; now: number; openHint?: string },
): string[] {
  if (selection.shown.length === 0) return [];
  const width = Math.max(20, options.width);
  const lines = selection.shown.map((record) =>
    rowLine(record, palette, width, options.frame, options.now),
  );
  if (selection.hidden > 0) {
    lines.push(palette.dim(`… ${selection.hidden} more`));
  }
  if (options.openHint) lines.push(palette.dim(options.openHint));
  return lines;
}

/**
 * Ticking wrapper around `widgetLines`. Owns its animation timer. It reports
 * back once there is nothing left to show, because a widget cannot remove
 * itself. Only the extension that installed it can remove it.
 */
export class SubagentActivityWidget implements Component {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly getSelection: (now: number) => WidgetSelection,
    private readonly onIdle: () => void,
    private readonly openHint?: string,
  ) {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    // Node keeps the process alive for an active interval; a widget must never
    // be the reason pi refuses to exit.
    this.timer.unref?.();
  }

  render(width: number): string[] {
    return widgetLines(this.getSelection(Date.now()), paletteOf(this.theme), {
      width,
      frame: this.frame,
      now: Date.now(),
      openHint: this.openHint,
    });
  }

  invalidate(): void {}

  dispose(): void {
    this.stop();
  }

  private tick(): void {
    if (this.getSelection(Date.now()).shown.length === 0) {
      this.stop();
      this.onIdle();
      return;
    }
    this.frame = (this.frame + 1) % RUNNING_FRAMES.length;
    this.tui.requestRender();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
