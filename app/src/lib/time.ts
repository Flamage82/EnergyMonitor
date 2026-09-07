function parts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines emit "24" for midnight
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour, minute: Number(map.minute), second: Number(map.second),
  };
}

export function zonedTimeToUtcMs(
  y: number, month1to12: number, day: number, h: number, min: number, s: number, timeZone: string,
): number {
  const guess = Date.UTC(y, month1to12 - 1, day, h, min, s);
  const p = parts(new Date(guess), timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = asIfUtc - guess;
  return guess - offset;
}

/** Epoch ms of `isoDate` ("YYYY-MM-DD") at 00:00:00 local to `timeZone`. */
export function localDateStartMs(isoDate: string, timeZone: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return zonedTimeToUtcMs(y, m, d, 0, 0, 0, timeZone);
}

export function monthStartMs(now: Date, timeZone: string): number {
  const p = parts(now, timeZone);
  return zonedTimeToUtcMs(p.year, p.month, 1, 0, 0, 0, timeZone);
}

/**
 * Epoch-ms window for a single calendar day in `timeZone`, `dayOffset` days from
 * the day containing `now` (0 = today, -1 = yesterday). `endMs` is `now` for
 * today, else the following local midnight. `atFloor` is true once the day is at
 * or before `dataStartDate` — there is no earlier day worth paging to.
 */
export function dayWindow(now: Date, timeZone: string, dataStartDate: string, dayOffset: number) {
  const p = parts(now, timeZone);
  // Shift the date through UTC so a day/month/year rollover is normalised.
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const startMs = zonedTimeToUtcMs(y, m, d, 0, 0, 0, timeZone);
  const endMs = dayOffset === 0
    ? now.getTime()
    : zonedTimeToUtcMs(y, m, d + 1, 0, 0, 0, timeZone);
  return { startMs, endMs, atFloor: startMs <= localDateStartMs(dataStartDate, timeZone) };
}

/**
 * Epoch-ms window for a calendar month in `timeZone`, `monthOffset` months from
 * the month containing `now` (0 = current, -1 = last month), clamped to the
 * `dataStartDate` floor. For a past month `endMs` is the month end and
 * `daysElapsed` is the full span; `atFloor` is true for the month that contains
 * `dataStartDate` (and any earlier one).
 */
export function monthWindow(now: Date, timeZone: string, dataStartDate: string, monthOffset: number) {
  const p = parts(now, timeZone);
  // `zonedTimeToUtcMs` -> `Date.UTC` normalises an out-of-range month index, so
  // `p.month + monthOffset` can run past either end of the year safely.
  const monthStart = zonedTimeToUtcMs(p.year, p.month + monthOffset, 1, 0, 0, 0, timeZone);
  const nextMonthStart = zonedTimeToUtcMs(p.year, p.month + monthOffset + 1, 1, 0, 0, 0, timeZone);
  const floorMs = localDateStartMs(dataStartDate, timeZone);
  const startMs = Math.max(monthStart, floorMs);
  const isCurrent = monthOffset === 0;
  const endMs = isCurrent ? now.getTime() : nextMonthStart;
  return {
    startMs,
    monthStart,
    endMs,
    floored: startMs > monthStart,
    daysElapsed: (endMs - startMs) / 86_400_000,
    isCurrent,
    atFloor: monthStart <= floorMs,
  };
}

/**
 * The billing window that both the month query and the bill must agree on: the
 * later of the calendar month start and the `dataStartDate` floor. Deriving the
 * fetched buckets and the supply-charge proration from one place stops the bill
 * charging supply for days it has no usage data for. Thin wrapper over
 * `monthWindow` at offset 0.
 */
export function effectiveMonthWindow(now: Date, timeZone: string, dataStartDate: string) {
  const { startMs, monthStart, floored, daysElapsed } = monthWindow(now, timeZone, dataStartDate, 0);
  return { startMs, monthStart, floored, daysElapsed };
}

export function localDayKey(tMs: number, timeZone: string): string {
  const p = parts(new Date(tMs), timeZone);
  const mm = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  return `${p.year}-${mm}-${dd}`;
}

export function monthLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, month: "long", year: "numeric" }).format(now);
}

/** Short weekday + day + month for a chart heading, e.g. "Mon 7 Sept". */
export function dayLabel(tMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone, weekday: "short", day: "numeric", month: "short",
  }).format(new Date(tMs));
}
