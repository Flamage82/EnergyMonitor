import { useState } from "react";
import { LiveNow } from "./components/LiveNow";
import { EnergyChart } from "./components/EnergyChart";
import { BillSummary } from "./components/BillSummary";
import { config } from "./config";
import { useMonthData } from "./hooks/useSeries";
import "./App.css";

function NotConfigured() {
  return (
    <main className="app">
      <header>
        <h1>Marburg Energy</h1>
      </header>
      <section className="section">
        <h2>Dashboard not configured</h2>
        <p className="banner" role="alert">
          No Worker URL is set. The deploy needs the <code>WORKER_URL</code> repository
          variable (see README &gt; Deploy); locally, set <code>VITE_WORKER_URL</code> in
          <code> app/.env.local</code>.
        </p>
      </section>
    </main>
  );
}

export default function App() {
  // A blank base URL means the deploy is misconfigured (no WORKER_URL variable).
  // Bail before mounting any data hook so we don't fire requests at the page's
  // own origin.
  if (!config.workerBaseUrl) return <NotConfigured />;
  return <Dashboard />;
}

function Dashboard() {
  // `now` is fixed at mount so every panel reads the same "current" instant.
  // The bill's month poll lives here; the chart owns a second one because it can
  // page to other months independently (an extra current-month request when
  // neither has paged away — fine at this app's cadence and traffic).
  const [now] = useState(() => new Date());
  const month = useMonthData(now);

  return (
    <main className="app">
      <header>
        <h1>Marburg Energy</h1>
      </header>
      <LiveNow />
      <EnergyChart now={now} />
      <BillSummary now={now} month={month} />
    </main>
  );
}
