import { LiveNow } from "./components/LiveNow";
import { EnergyChart } from "./components/EnergyChart";
import { BillSummary } from "./components/BillSummary";
import "./App.css";

export default function App() {
  return (
    <main className="app">
      <header>
        <h1>Marburg Energy</h1>
      </header>
      <LiveNow />
      <EnergyChart />
      <BillSummary />
    </main>
  );
}
