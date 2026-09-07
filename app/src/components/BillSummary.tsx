import { config } from "../config";
import type { AsyncState } from "../hooks/usePolledFetch";
import { allocateBill, type GroupBucket, type HouseholdBill } from "../lib/energy";
import { localDateStartMs, monthLabel, monthStartMs } from "../lib/time";
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

export function BillSummary({ now, month }: { now: Date; month: AsyncState<GroupBucket[]> }) {
  const { data, error } = month;

  const monthStart = monthStartMs(now, config.timezone);
  const floor = localDateStartMs(config.dataStartDate, config.timezone);
  const effStart = Math.max(monthStart, floor);
  const daysElapsed = (now.getTime() - effStart) / 86_400_000;

  const bill = allocateBill(data ?? [], {
    bucketSeconds: config.monthBucketSeconds,
    tariff: config.tariff,
    shares: config.shares,
    solarAllocation: config.solarAllocation,
    daysElapsed,
  });

  return (
    <Section title={`Bill so far — ${monthLabel(now, config.timezone)}`} error={error}>
      <div className="bill-cards">
        <Card testId="bill-main" name="Main house" bill={bill.mainHouse} />
        <Card testId="bill-nicki" name="Nicki" bill={bill.nicki} />
      </div>
      <p className="note">
        Estimate only — excludes unmonitored loads.
        {effStart > monthStart ? ` Covers ${config.dataStartDate} onwards (monitoring reconfigured).` : ""}
        {bill.gaps > 0 ? ` ${bill.gaps} data ${bill.gaps === 1 ? "gap" : "gaps"}.` : ""}
        {" "}Rates: {config.tariff.importCentsPerKwh}c/kWh import,
        {" "}{config.tariff.supplyChargeCentsPerDay}c/day supply, {config.tariff.feedInCentsPerKwh}c/kWh feed-in.
        Supply charge &amp; solar income split {config.shares.mainHouse}:{config.shares.nicki}.
      </p>
    </Section>
  );
}
