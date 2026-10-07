import { config } from "../config";
import type { AsyncState } from "../hooks/usePolledFetch";
import { allocateBill, inferBucketSeconds, type GroupBucket, type HouseholdBill } from "../lib/energy";
import { effectiveMonthWindow, localDateStartMs, monthLabel } from "../lib/time";
import { Section } from "./Section";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

// Plain-language version of the data-floor caveat for a household reader:
// "Excludes usage before 7 Oct, 10:00 am (before monitoring was corrected)."
function excludedDaysNote(dataStartDate: string, timeZone: string): string {
  const hasTime = dataStartDate.includes("T");
  const label = new Intl.DateTimeFormat("en-AU", {
    timeZone, day: "numeric", month: "short",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(localDateStartMs(dataStartDate, timeZone)));
  return `Excludes usage before ${label} (before monitoring was corrected).`;
}

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

  const { floored, daysElapsed } = effectiveMonthWindow(now, config.timezone, config.dataStartDate);

  const bill = allocateBill(data ?? [], {
    bucketSeconds: inferBucketSeconds(data ?? [], config.monthBucketSeconds),
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
        {floored ? ` ${excludedDaysNote(config.dataStartDate, config.timezone)}` : ""}
        {bill.gaps > 0 ? ` ${bill.gaps} data ${bill.gaps === 1 ? "gap" : "gaps"}.` : ""}
        {" "}Rates: {config.tariff.importCentsPerKwh}c/kWh import,
        {" "}{config.tariff.supplyChargeCentsPerDay}c/day supply, {config.tariff.feedInCentsPerKwh}c/kWh feed-in.
        Supply charge &amp; solar income split {config.shares.mainHouse}:{config.shares.nicki}.
      </p>
    </Section>
  );
}
