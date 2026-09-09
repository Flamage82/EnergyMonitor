# Metering accuracy — monitor vs. the retailer's meter

**Status:** open, hardware fix planned. Revisit ~mid-Sep 2026 once a week or two
of daily reconciliation data has built up and the new CT clamps are fitted.

## The discrepancy

The retailer's figures for **8 Sep 2026** were import **29.58 kWh**, export
**7.13 kWh**. The dashboard's "This month" view showed **25.1 / 6.4** for that
day. That gap prompted a full reconciliation.

## What the reconciliation found

`node scripts/reconcile-day.mjs 2026-09-08 29.58 7.13` pulls the same ten feeds
the app uses, through the live Worker, at four bucket sizes and integrates
import/export three ways:

| bucket | import kWh | export kWh | signed-net kWh | null buckets |
|-------:|-----------:|-----------:|---------------:|-------------:|
|    60s | 26.42 (−10.7%) | 7.70 (+8.0%) | 18.72 | 0 |
|   300s | 26.06 (−11.9%) | 7.24 (+1.5%) | 18.82 | 0 |
|   900s | 25.46 (−13.9%) | 6.44 (−9.7%) | 19.02 | 0 |
|  1800s | 25.21 (−14.8%) | 5.91 (−17.1%) | 19.30 | 0 |

(Percentages are vs. the retailer. The Worker floors `/series` at 60 s, so 60 s
is the finest proxy available for the raw 5 s data — still 12× finer than the
month view's 900 s.)

### 1. Bucketing is real but minor

Our import/export split classifies each bucket as net-import **or** net-export by
its *average* power, so a within-bucket swing across zero (solar near break-even
under moving cloud) is lost from both totals. Measured cost, 60 s → 900 s:

- import: −1.0 kWh (~3.6%)
- export: −1.3 kWh (~16%)

Roughly symmetric in kWh, as expected. Accumulator feeds or a finer interval
recover all of it. **This is the only part the app can fix.**

### 2. The dominant error is hardware

The **signed-net** column is 18.7–19.3 kWh regardless of bucket size — net energy
is bucket-independent (averaging cancels symmetrically). The retailer's signed
net is 29.58 − 7.13 = **22.45 kWh**. The monitor is **3.73 kWh short — 16.6% of
the true net — at every resolution.** No software change touches this number.

### 3. Signature: un-metered load / load-CT under-read

At true (60 s) resolution the monitor reads import **~11% low** and export
**~8% high**. That is the signature of load the clamps don't see: real net is
more "import" than measured, so we undercount import *and* overcount export. The
900 s view's export only looks low because bucketing then subtracts ~1.3 kWh.

Contributing factors, in likely order:

- **No grid-tie reference.** Net is reconstructed from ten independent CT clamps
  (`sum(8 main) + nicki − solar`); every clamp's calibration and low-power-factor
  droop stacks into that sum, and any main-house circuit without a clamp is
  invisible. Nicki's clamp is already on a whole phase, so her leg is a true
  total; the main house is the per-circuit sum.
- **Clip-on CT accuracy.** These typically read a few % low, worst on distorted /
  low-PF loads — lighting and general power. "Power 1" alone was 16.6 kWh on
  8 Sep, the single largest load.

### 4. Not a data problem

Zero null samples, full 00:00–00:00 coverage on every feed. Not dropouts.

## Plan

| Fix | Recovers | Status |
|-----|----------|--------|
| CT clamps on the **main tails** (true main-house import, comparable to the meter) | most of the 16.6% net error | **clamps to be ordered** |
| emoncms `grid_import_kwh` / `grid_export_kwh` accumulator feeds — `Allow positive → Power to kWh` for import, mirror for export, integrated at the native rate | ~1.0 kWh import + ~1.3 kWh export per day (all bucketing loss) | not started; needs an app change to read accumulators |
| Per-feed calibration factor in `app/src/config.ts` (scale each feed's watts before bucketing) | the residual few-% CT error, once a reference number exists | not started; deferred until the tails CT gives a reference |

## How to keep watching it

Run the reconciliation whenever a new daily figure comes in from the retailer:

```
node scripts/reconcile-day.mjs <YYYY-MM-DD> <providerImportKwh> <providerExportKwh>
```

Track the signed-net percentage over ~2 weeks:

- **stable ratio** → a fixed calibration factor will fix it
- **wandering ratio** → an intermittent un-metered load; hunt for the circuit
  (subboard, hardwired appliance, a breaker with no clamp)
