import { config } from '../config/index.js';

const bootReal = Date.now();
const bootSim = Date.parse(`${config.SIMULATED_CURRENT_DATE}T09:00:00Z`);

/**
 * Product clock. Demo data is anchored at SIMULATED_CURRENT_DATE 09:00 (the planner's "9 AM"),
 * so detection timestamps in seed data are in the past relative to "now" and the
 * detect-to-investigate measurements come out positive and meaningful.
 * Timestamps are naive-UTC ISO strings (no timezone conversion anywhere).
 */
export function nowMs(): number {
  return config.CLOCK_MODE === 'real' ? Date.now() : bootSim + (Date.now() - bootReal);
}

export function nowIso(): string {
  return new Date(nowMs()).toISOString().slice(0, 19);
}

/** Parse a naive ISO timestamp produced by this app (treated as UTC). */
export function parseTs(ts: string): number {
  return Date.parse(ts.endsWith('Z') ? ts : `${ts}Z`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 15, 09:02" */
export function nowDisplay(): string {
  const d = new Date(nowMs());
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}, ${hh}:${mm}`;
}
