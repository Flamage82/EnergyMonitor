import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { config } from "../config";
import { useTodaySeries } from "../hooks/useSeries";
import type { AsyncState } from "../hooks/usePolledFetch";
import { inferBucketSeconds, type GroupBucket } from "../lib/energy";
import { toTodayPoints, toMonthDayPoints } from "../lib/chart";
import { Section } from "./Section";

type Range = "today" | "month";
const KEY = "energychart.range";
const initialRange = (): Range => {
  try { return localStorage.getItem(KEY) === "month" ? "month" : "today"; } catch { return "today"; }
};

// Raw feed watts carry ~10 decimal places — round to whole watts for the tooltip.
const wattTip = (v: unknown) => `${Math.round(Number(v)).toLocaleString()} W`;
const hourTip = (t: unknown) =>
  new Date(Number(t)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const kwhTip = (v: unknown) => `${Number(v).toFixed(1)} kWh`;

export function EnergyChart({ month }: { month: AsyncState<GroupBucket[]> }) {
  const [range, setRange] = useState<Range>(initialRange);
  const today = useTodaySeries();
  const choose = (r: Range) => { setRange(r); try { localStorage.setItem(KEY, r); } catch { /* ignore */ } };

  const err = range === "today" ? today.error : month.error;

  // Recharts' default axis/grid/legend strokes are a fixed dark grey — near
  // invisible on the dark theme. Feed them the theme-aware custom properties so
  // they track `prefers-color-scheme` like the series colours already do.
  const axis = "var(--chart-axis)";
  const grid = "var(--chart-grid)";
  const legendStyle = { color: "var(--chart-axis)" };
  const monthBucketSeconds = inferBucketSeconds(month.data ?? [], config.monthBucketSeconds);

  return (
    <Section title="Usage" error={err}>
      <div className="toggle" role="group" aria-label="Chart range">
        <button aria-pressed={range === "today"} onClick={() => choose("today")}>Today</button>
        <button aria-pressed={range === "month"} onClick={() => choose("month")}>This month</button>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        {range === "today" ? (
          <ComposedChart data={toTodayPoints(today.data ?? [])}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis dataKey="t" stroke={axis} tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" })} />
            <YAxis stroke={axis} tickFormatter={(n) => `${Math.round(n / 100) / 10} kW`} />
            <Tooltip formatter={wattTip} labelFormatter={hourTip} />
            <Legend wrapperStyle={legendStyle} />
            {/* Stacked household load: blue (main) under aqua (Nicki) — distinct
                hues (the old blue/violet pair was not), each with a 2px outline
                so the boundary between the two fills stays legible. */}
            <Area type="monotone" dataKey="main" stackId="load" stroke="var(--chart-main)" strokeWidth={2} fill="var(--chart-main)" fillOpacity={0.7} name="Main house" />
            <Area type="monotone" dataKey="nicki" stackId="load" stroke="var(--chart-nicki)" strokeWidth={2} fill="var(--chart-nicki)" fillOpacity={0.85} name="Nicki" />
            <Line type="monotone" dataKey="solar" stroke="var(--chart-solar)" strokeWidth={2} dot={false} name="Solar" />
          </ComposedChart>
        ) : (
          <ComposedChart data={toMonthDayPoints(month.data ?? [], monthBucketSeconds, config.timezone)}>
            <CartesianGrid strokeDasharray="3 3" stroke={grid} />
            <XAxis dataKey="day" stroke={axis} tickFormatter={(d: string) => d.slice(8)} />
            <YAxis stroke={axis} tickFormatter={(n) => `${Math.round(n)} kWh`} />
            <Tooltip formatter={kwhTip} />
            <Bar dataKey="netImportKwh" fill="var(--chart-main)" name="Net import" />
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </Section>
  );
}
