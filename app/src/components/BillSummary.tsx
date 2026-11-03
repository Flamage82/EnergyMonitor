import { useState } from "react";
import { config } from "../config";
import { useMonthData } from "../hooks/useSeries";
import { allocateBill, inferBucketSeconds, splitActualBill, type HouseholdBill } from "../lib/energy";
import { localDateStartMs, localDayKey, monthLabel, monthWindow } from "../lib/time";
import { Section } from "./Section";

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;

// " (75%)" of the typed bill; nothing for a $0 bill, which has no shares.
const pct = (part: number, whole: number) => (whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : "");

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

// Stands in for a figure until its month has loaded; the labels stay put so the
// card doesn't change shape when the numbers arrive.
const Skeleton = () => <span className="skeleton" aria-hidden="true" />;

function Card({ testId, name, bill, totalLabel }: {
  testId: string; name: string; bill: HouseholdBill | null; totalLabel: string;
}) {
  const value = (render: (b: HouseholdBill) => string) => (bill ? render(bill) : <Skeleton />);
  return (
    <div className="bill-card" data-testid={testId} aria-busy={bill === null}>
      <h3>{name}</h3>
      <dl>
        <div><dt>Imported</dt><dd>{value((b) => `${b.importKwh.toFixed(1)} kWh`)}</dd></div>
        <div><dt>Usage cost</dt><dd>{value((b) => money(b.importCost))}</dd></div>
        <div><dt>Solar credit</dt><dd>{value((b) => money(b.solarCreditShare))}</dd></div>
        <div><dt>Supply charge</dt><dd>{value((b) => money(b.supplyChargeShare))}</dd></div>
        <div className="total"><dt>{totalLabel}</dt><dd>{value((b) => money(b.total))}</dd></div>
      </dl>
    </div>
  );
}

export function BillSummary({ now }: { now: Date }) {
  // 0 = the current month-to-date; each step back is one whole calendar month.
  // Not persisted — a reload lands back on the live edge.
  const [monthOffset, setMonthOffset] = useState(0);
  // The real bill as typed; a string so partial input ("12.") isn't mangled.
  // Null until typed in, when the month's recorded bill (if any) shows instead.
  // Belongs to one month, so paging resets it.
  const [typedBill, setTypedBill] = useState<string | null>(null);
  const { data, error } = useMonthData(now, monthOffset);

  const { monthStart, floored, daysElapsed, isCurrent, atFloor } =
    monthWindow(now, config.timezone, config.dataStartDate, monthOffset);

  // No data yet (first load, or just paged to another month) means no bill — not
  // a zero-usage one, which would show a supply-charge-only total as if it were real.
  const bill = data && allocateBill(data, {
    bucketSeconds: inferBucketSeconds(data, config.monthBucketSeconds),
    tariff: config.tariff,
    shares: config.shares,
    solarAllocation: config.solarAllocation,
    daysElapsed,
  });

  const label = monthLabel(new Date(monthStart), config.timezone);
  const totalLabel = isCurrent ? "Running total" : "Total";
  const step = (delta: -1 | 1) => {
    setMonthOffset((o) => Math.min(0, o + delta));
    setTypedBill(null);
  };

  const recorded = config.actualBills[localDayKey(monthStart, config.timezone).slice(0, 7)];
  const actualInput = typedBill ?? (recorded === undefined ? "" : recorded.toFixed(2));
  const actual = actualInput.trim() === "" ? NaN : Number(actualInput);
  const hasActual = Number.isFinite(actual) && actual >= 0;
  const split = bill && hasActual ? splitActualBill(bill, actual) : null;

  return (
    <Section title={isCurrent ? `Bill so far — ${label}` : `Bill — ${label}`} error={error}>
      <div className="chart-controls bill-controls">
        <div className="stepper" role="group" aria-label="Bill month">
          <button aria-label="Previous month" disabled={atFloor} onClick={() => step(-1)}>‹</button>
          <button aria-label="Next month" disabled={isCurrent} onClick={() => step(1)}>›</button>
        </div>
      </div>
      <div className="bill-cards">
        <Card testId="bill-main" name="Main house" bill={bill?.mainHouse ?? null} totalLabel={totalLabel} />
        <Card testId="bill-nicki" name="Nicki" bill={bill?.nicki ?? null} totalLabel={totalLabel} />
      </div>
      <div className="actual-bill">
        <label>
          <span className="label">Actual bill</span>
          <span className="money-input">
            $<input
              type="number" inputMode="decimal" min="0" step="0.01" placeholder="0.00"
              value={actualInput} onChange={(e) => setTypedBill(e.target.value)}
            />
          </span>
        </label>
        {split && (
          <>
            <dl data-testid="actual-split">
              <div><dt>Main house{pct(split.mainHouse, actual)}</dt><dd>{money(split.mainHouse)}</dd></div>
              <div><dt>Nicki{pct(split.nicki, actual)}</dt><dd>{money(split.nicki)}</dd></div>
            </dl>
            <p className="note">
              Supply charge ({money(split.supplyTotal)}) kept as is; usage less solar
              credit scaled ×{split.scale.toFixed(2)} to fit.
            </p>
          </>
        )}
        {bill && hasActual && !split && (
          <p className="note">Nothing to scale: no net usage measured, or the bill is below the supply charge.</p>
        )}
      </div>
      <p className="note">
        Estimate only — excludes unmonitored loads.
        {floored ? ` ${excludedDaysNote(config.dataStartDate, config.timezone)}` : ""}
        {bill && bill.gaps > 0 ? ` ${bill.gaps} data ${bill.gaps === 1 ? "gap" : "gaps"}.` : ""}
        {" "}Rates: {config.tariff.importCentsPerKwh}c/kWh import,
        {" "}{config.tariff.supplyChargeCentsPerDay}c/day supply, {config.tariff.feedInCentsPerKwh}c/kWh feed-in.
        Supply charge &amp; solar income split {config.shares.mainHouse}:{config.shares.nicki}.
      </p>
    </Section>
  );
}
