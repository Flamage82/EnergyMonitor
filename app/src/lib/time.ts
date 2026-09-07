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

export function monthStartMs(now: Date, timeZone: string): number {
  const p = parts(now, timeZone);
  return zonedTimeToUtcMs(p.year, p.month, 1, 0, 0, 0, timeZone);
}

export function daysElapsedInMonth(now: Date, timeZone: string): number {
  return (now.getTime() - monthStartMs(now, timeZone)) / 86_400_000;
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
