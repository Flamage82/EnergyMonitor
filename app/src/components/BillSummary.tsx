import { config } from "../config";
import { useMonthData } from "../hooks/useSeries";
import { allocateBill, type HouseholdBill } from "../lib/energy";
import { daysElapsedInMonth, monthLabel } from "../lib/time";
import { Section } from "./Section";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

function Card({ testId, name, bill }: { testId: string; name: string; bill: HouseholdBill }) {
  return (
    <div className="bill-card" data-testid={testId}>
      <h3>{name}</h3>
      <dl>
        <div><dt>Imported</dt><dd>{bill.importKwh.toFixed(1)} kWh</dd></div>
        <div><dt>Usage cost</dt><dd>{money(bill.importCost)}</dd></div>
        <div><dt>Solar credit</dt><dd>{money(bill.solarCreditShare)}</dd></div>
        <div><dt>Supply charge</dt><dd>{money(bill.supplyChargeShare)}</dd></div>
        <div className="total"><dt>Running total</dt><dd>{money(bill.total)}</dd></div>
      </dl>
    </div>
  );
}

export function BillSummary() {
  const now = new Date();
  const { data, error } = useMonthData(now);
  const bill = allocateBill(data ?? [], {
    bucketSeconds: config.bucketSeconds,
    tariff: config.tariff,
    shares: config.shares,
    solarAllocation: config.solarAllocation,
    daysElapsed: daysElapsedInMonth(now, config.timezone),
  });

  return (
    <Section title={`Bill so far — ${monthLabel(now, config.timezone)}`} error={error}>
      <div className="bill-cards">
        <Card testId="bill-main" name="Main house" bill={bill.mainHouse} />
        <Card testId="bill-nicki" name="Nicki" bill={bill.nicki} />
      </div>
      <p className="note">
        Estimate only — excludes unmonitored loads
        {bill.gaps > 0 ? ` · ${bill.gaps} data gaps` : ""}. Rates: {config.tariff.importCentsPerKwh}c/kWh import,
        {" "}{config.tariff.supplyChargeCentsPerDay}c/day supply, {config.tariff.feedInCentsPerKwh}c/kWh feed-in.
        Supply charge &amp; solar income split {config.shares.mainHouse}:{config.shares.nicki}.
      </p>
    </Section>
  );
}
