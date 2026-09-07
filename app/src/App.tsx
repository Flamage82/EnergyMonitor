import { useState } from "react";
import { LiveNow } from "./components/LiveNow";
import { EnergyChart } from "./components/EnergyChart";
import { BillSummary } from "./components/BillSummary";
import { useMonthData } from "./hooks/useSeries";
import "./App.css";

export default function App() {
  // One month poll for the whole app: the chart and the bill share it rather
  // than each mounting their own useMonthData. `now` is fixed at mount so both
  // read the same window.
  const [now] = useState(() => new Date());
  const month = useMonthData(now);

  return (
    <main className="app">
      <header>
        <h1>Marburg Energy</h1>
      </header>
      <LiveNow />
      <EnergyChart month={month} />
      <BillSummary now={now} month={month} />
    </main>
  );
}
