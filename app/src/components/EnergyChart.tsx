import { useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { config } from "../config";
import { useTodaySeries, useMonthData } from "../hooks/useSeries";
import { toTodayPoints, toMonthDayPoints } from "../lib/chart";
import { Section } from "./Section";

type Range = "today" | "month";
const KEY = "energychart.range";
const initialRange = (): Range => {
  try { return localStorage.getItem(KEY) === "month" ? "month" : "today"; } catch { return "today"; }
};

export function EnergyChart() {
  const [range, setRange] = useState<Range>(initialRange);
  const today = useTodaySeries();
  const month = useMonthData();
  const choose = (r: Range) => { setRange(r); try { localStorage.setItem(KEY, r); } catch { /* ignore */ } };

  const err = range === "today" ? today.error : month.error;

  return (
    <Section title="Usage" error={err}>
      <div className="toggle" role="group">
        <button aria-pressed={range === "today"} onClick={() => choose("today")}>Today</button>
        <button aria-pressed={range === "month"} onClick={() => choose("month")}>This month</button>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        {range === "today" ? (
          <ComposedChart data={toTodayPoints(today.data ?? [])}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString([], { hour: "2-digit" })} />
            <YAxis tickFormatter={(n) => `${Math.round(n / 100) / 10} kW`} />
            <Tooltip />
            <Area type="monotone" dataKey="main" stackId="load" stroke="#2563eb" fill="#93c5fd" name="Main house" />
            <Area type="monotone" dataKey="nicki" stackId="load" stroke="#7c3aed" fill="#c4b5fd" name="Nicki" />
            <Line type="monotone" dataKey="solar" stroke="#f59e0b" dot={false} name="Solar" />
          </ComposedChart>
        ) : (
          <ComposedChart data={toMonthDayPoints(month.data ?? [], config.bucketSeconds, config.timezone)}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8)} />
            <YAxis tickFormatter={(n) => `${Math.round(n)} kWh`} />
            <Tooltip />
            <Bar dataKey="netImportKwh" fill="#2563eb" name="Net import (kWh)" />
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </Section>
  );
}
