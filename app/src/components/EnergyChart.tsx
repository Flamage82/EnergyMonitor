import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { config } from "../config";
import { useTodaySeries, useMonthData } from "../hooks/useSeries";
import type { AsyncState } from "../hooks/usePolledFetch";
import { inferBucketSeconds, type GroupBucket } from "../lib/energy";
import { toTodayPoints, toTodayLoadPoints, toMonthDayPoints } from "../lib/chart";
import { dayWindow, monthWindow, dayLabel, monthLabel } from "../lib/time";
import { Section } from "./Section";

type Range = "today" | "loads" | "month";
const KEY = "energychart.range";
const initialRange = (): Range => {
  try {
    const v = localStorage.getItem(KEY);
    return v === "month" || v === "loads" ? v : "today";
  } catch { return "today"; }
};

// Eight-slot categorical palette (defined in App.css) for the by-load lines,
// applied in the validated order — one fixed hue per load group, never cycled.
const loadColors = [
  "var(--chart-cat-1)", "var(--chart-cat-2)", "var(--chart-cat-3)", "var(--chart-cat-4)",
  "var(--chart-cat-5)", "var(--chart-cat-6)", "var(--chart-cat-7)", "var(--chart-cat-8)",
];

// Raw feed watts carry ~10 decimal places — round to whole watts for the tooltip.
const wattTip = (v: unknown) => `${Math.round(Number(v)).toLocaleString()} W`;
const hourTip = (t: unknown) =>
  new Date(Number(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const kwhTip = (v: unknown) => `${Number(v).toFixed(1)} kWh`;

// Recharts' default axis/grid/legend strokes are a fixed dark grey — near
// invisible on the dark theme. Feed them the theme-aware custom properties so
// they track `prefers-color-scheme` like the series colours already do.
const axis = "var(--chart-axis)";
const grid = "var(--chart-grid)";
const legendStyle = { color: "var(--chart-axis)" };

// The tooltip needs the same dark-theme treatment the axes got — Recharts hard-
// codes a white panel. `zIndex` lifts it above the legend wrapper, which Recharts
// renders after it in the DOM (so an overlap would otherwise paint legend text
// over the panel); `itemStyle` colour keeps the readout text in readable ink
// while the coloured bullet still carries series identity.
const tooltipProps = {
  wrapperStyle: { zIndex: 10 },
  contentStyle: {
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    boxShadow: "var(--shadow)",
  },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)", padding: "1px 0" },
} as const;

// Shared chrome for the two intraday (watts-over-hours) charts.
const hourGrid = <CartesianGrid strokeDasharray="3 3" stroke={grid} />;
const hourX = (
  <XAxis dataKey="t" stroke={axis} tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" })} />
);
// No intraday series is ever negative (loads are areas, solar is flipped
// positive), so pin the axis floor at zero — Recharts' auto-domain otherwise
// pads a big empty band below the data.
const kwY = <YAxis stroke={axis} domain={[0, "auto"]} tickFormatter={(n) => `${Math.round(n / 100) / 10} kW`} />;
const wattTooltip = <Tooltip {...tooltipProps} formatter={wattTip} labelFormatter={hourTip} />;

function TodayChart({ buckets }: { buckets: GroupBucket[] }) {
  return (
    <ComposedChart data={toTodayPoints(buckets)}>
      {hourGrid}{hourX}{kwY}{wattTooltip}
      <Legend wrapperStyle={legendStyle} />
      {/* Stacked household load: blue (main) under aqua (Nicki) — distinct hues,
          each with a 2px outline so the boundary between the two fills stays
          legible. */}
      <Area type="monotone" dataKey="main" stackId="load" stroke="var(--chart-main)" strokeWidth={2} fill="var(--chart-main)" fillOpacity={0.7} name="Main house" />
      <Area type="monotone" dataKey="nicki" stackId="load" stroke="var(--chart-nicki)" strokeWidth={2} fill="var(--chart-nicki)" fillOpacity={0.85} name="Nicki" />
      <Line type="monotone" dataKey="solar" stroke="var(--chart-solar)" strokeWidth={2} dot={false} name="Solar" />
    </ComposedChart>
  );
}

function LoadsChart({ buckets }: { buckets: Parameters<typeof toTodayLoadPoints>[0] }) {
  return (
    <ComposedChart data={toTodayLoadPoints(buckets, config.loadGroups, config.feeds.solar)}>
      {hourGrid}{hourX}{kwY}{wattTooltip}
      <Legend wrapperStyle={legendStyle} />
      {/* One line per load group, hue fixed by palette slot so a circuit keeps
          its colour no matter what the others are doing. */}
      {config.loadGroups.map((g, i) => (
        <Line key={g.label} type="monotone" dataKey={g.label} stroke={loadColors[i]} strokeWidth={2} dot={false} name={g.label} />
      ))}
    </ComposedChart>
  );
}

function MonthChart({ month }: { month: AsyncState<GroupBucket[]> }) {
  const bucketSeconds = inferBucketSeconds(month.data ?? [], config.monthBucketSeconds);
  return (
    <ComposedChart data={toMonthDayPoints(month.data ?? [], bucketSeconds, config.timezone)}>
      <CartesianGrid strokeDasharray="3 3" stroke={grid} />
      <XAxis dataKey="day" stroke={axis} tickFormatter={(d: string) => d.slice(8)} />
      <YAxis stroke={axis} tickFormatter={(n) => `${Math.round(n)} kWh`} />
      <Tooltip {...tooltipProps} formatter={kwhTip} />
      <Bar dataKey="netImportKwh" fill="var(--chart-main)" name="Net import" />
    </ComposedChart>
  );
}

export function EnergyChart({ now }: { now: Date }) {
  const [range, setRange] = useState<Range>(initialRange);
  // `dayOffset` drives the two intraday views, `monthOffset` the month view — a
  // separate step each because they page in different units. Neither persists;
  // a reload lands back on the live edge.
  const [dayOffset, setDayOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);

  const today = useTodaySeries(now, dayOffset);
  const month = useMonthData(now, monthOffset);
  const choose = (r: Range) => { setRange(r); try { localStorage.setItem(KEY, r); } catch { /* ignore */ } };

  const isMonth = range === "month";
  const dayW = dayWindow(now, config.timezone, config.dataStartDate, dayOffset);
  const monthW = monthWindow(now, config.timezone, config.dataStartDate, monthOffset);

  const step = (delta: -1 | 1) => {
    if (isMonth) setMonthOffset((o) => Math.min(0, o + delta));
    else setDayOffset((o) => Math.min(0, o + delta));
  };
  const atFloor = isMonth ? monthW.atFloor : dayW.atFloor;
  const atLiveEdge = isMonth ? monthOffset >= 0 : dayOffset >= 0;

  const label = isMonth
    ? monthLabel(new Date(monthW.monthStart), config.timezone)
    : dayOffset === 0 ? "Today" : dayLabel(dayW.startMs, config.timezone);

  const err = isMonth ? month.error : today.error;
  const chart =
    range === "today" ? <TodayChart buckets={today.data?.buckets ?? []} />
    : range === "loads" ? <LoadsChart buckets={today.data?.feedBuckets ?? []} />
    : <MonthChart month={month} />;

  return (
    <Section title={`Usage — ${label}`} error={err}>
      <div className="chart-controls">
        <div className="toggle" role="group" aria-label="Chart range">
          <button aria-pressed={range === "today"} onClick={() => choose("today")}>Today</button>
          <button aria-pressed={range === "loads"} onClick={() => choose("loads")}>By load</button>
          <button aria-pressed={range === "month"} onClick={() => choose("month")}>This month</button>
        </div>
        <div className="stepper" role="group" aria-label={isMonth ? "Chart month" : "Chart day"}>
          <button aria-label="Previous" disabled={atFloor} onClick={() => step(-1)}>‹</button>
          <button aria-label="Next" disabled={atLiveEdge} onClick={() => step(1)}>›</button>
        </div>
      </div>
      {/* The by-load view carries eight series: a taller panel keeps the plot
          readable and gives the eight-row tooltip room to sit clear of the
          legend below it. */}
      <ResponsiveContainer width="100%" height={range === "loads" ? 380 : 300}>
        {chart}
      </ResponsiveContainer>
    </Section>
  );
}
