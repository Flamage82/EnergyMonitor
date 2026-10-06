# Metering accuracy — monitor vs. the retailer's meter

**Status (7 Oct 2026):** solved in software terms. **Every phase-C channel
reads half.** AirCon, Pool and Solar each need ×2. Phase A and Nicki (B) are
correct. There is no constant unmetered load. A year of AGL half-hourly data
fits that rule to R² 0.9996, and every day is within 0.8 kWh of the meter. The
physical cause is still open (see [Cause](#cause-still-open)).

**Since 7 Oct 09:29 the ×2 is applied at the source.** The IoTaWatt's emoncms
output formulas for AirCon, Pool and Solar now carry the ×2: the first doubled
post was at 09:29:30. The app's calibration ends at that moment and only
corrects older history. If the phase-C fault is fixed on site, those output
formulas must go back to ×1.

**IoTaWatt integrator feeds (from 7 Oct 09:48).** These are emoncms inputs
12–14. Each carries **average watts per 30 s post**, despite the "Wh" unit the
IoTaWatt forces. Export is negative.

| feed | id | |
|---|---|---|
| Net | 546960 | equals the sum of the ten circuit feeds to the watt |
| Imports | 546961 | the integrator's positive part |
| Exports | 546962 | the integrator's negative part |

**Per-sample split confirmed (7 Oct, passing cloud).** In 3 of the first 17
posts, both Imports and Exports were non-zero. At 09:53:00, Net was +101 W
but Imports was 614 W and Exports −512 W, where netting the 30 s average gives
101 W of import only. Imports + Exports equals Net on every post. Averages of
these feeds therefore stay correct at any bucket size: they remove the
bucketing shortfall. Still to do before the bill switches over: check them
against the next AGL download.

**Fix first applied in the app (7 Oct, before the source change).** `config.calibration` in
`app/src/config.ts` holds a per-feed timeline of factors. `lib/calibration.ts`
applies it to every `/series` response and every live reading, so the bill and
all charts use corrected watts. emoncms still stores the raw readings. The
timeline also undoes scaling baked into the history. Solar's emoncms formula
carried ×2 until 28 Sep 13:25, so it gets ×1 before then. Water treatment was
logged doubled from 28 Sep 13:25 to 4 Oct 12:40, so it gets ×0.5 for that window.

## Multiplier fit (7 Oct 2026)

`node scripts/fit-multipliers.mjs <AGL MyUsageData csv>` regresses AGL's
half-hourly signed net (import − export) on each channel's energy for the
same slot: `agl_net = Σ kᵢ·Eᵢ + c`. Signed net is linear in the circuits
whether the meter nets across phases or per phase. Each kᵢ is that channel's
multiplier. 1,336 half-hours, 8 Sep → 5 Oct:

| channel | phase | fitted ×  | |
|---|---|---:|---|
| Power 1, Power 2, Oven | A | 1.00–1.01 ± 0.005 | correct |
| Light 1, Light 2 | A | 1.04–1.05 ± 0.01–0.04 | small loads, ≈1 |
| Water treatment | A | not determinable | flat ~45 W load, trades off against the constant |
| **Air conditioner** | C | **2.01 ± 0.003** | night-only fit: 1.97 |
| **Pool** | C | **1.99 ± 0.015** | 2.4 at its old ~100 W low-speed duty |
| **Solar** (plain C) | C | **2.02 ± 0.002** | the old device ×2 fitted 1.02 |
| Nicki | B | 1.01 ± 0.004 | correct |
| constant | — | ≈ 0 | the "~40 W unmetered" was Pool reading half |

Fixed **AirCon ×2, Pool ×2, Solar ×2** (all else ×1):

| | slot RMS | daily net error |
|---|---:|---|
| raw (all ×1) | 438 Wh | mean 9.8 kWh, max 15.0 |
| AirCon ×2 only | 214 Wh | mean 3.6 kWh, max 16.8 |
| **phase C ×2** | **21 Wh** | **mean 0.26 kWh, max 0.79** (26 days) |

Leave-one-day-out, the fixed ×2 rule (21 Wh) does as well as the free fit
(22 Wh). So ×2 is the model; the extra digits are noise.

### Usable window and config timeline

- **Before 8 Sep 2026 the data is not comparable.** The monitor missed
  **1.5–2 kW** around the clock (overnight too). The gap dropped to ~15 W on
  7–8 Sep, when Nicki's feed (545440) started. Nicki's own load is only
  ~250 W median, so the earlier setup was missing more than her house. The
  eleven months before that can't calibrate the current setup.
- Scaling baked into the logs by the emoncms output formula, inferred from
  the solar clipping plateau and the Water channel's baseline. The script
  normalises it away:

  | from | config |
  |---|---|
  | → 28 Sep 12:30 | Solar phase C **×2** (plateau 4.2–4.5 kW) |
  | 28 Sep 12:30–13:30 | C − A test (excluded) |
  | 28 Sep 13:25 | Solar plain C (plateau ~2.1 kW); **Water treatment ×2** (overnight 45 → 97 W, AGL saw no change). The ×2 looks to have moved to the wrong channel |
  | 4 Oct 11:10–12:40 | Solar back to ~4.05 kW (second C − A test, excluded) |
  | 4 Oct 12:40 → | all ×1; Water back to 45 W |

- From 4 Oct ~12:50 the **pool heater** is in use (confirmed by the owner).
  Logged Pool went from ~100 W to a ~400 W base with ~1 kW peaks. AGL sees it
  too: real load, not config. At that current Pool fits ×1.99.

### Cause (still open)

The data points to a **current-scale error**: the IoTaWatt sees half the
current on each phase-C channel. It does not look like a wrong voltage
reference.

- **Solar's factor doesn't move with power factor.** Solar's PF on C has
  been seen at both 0.88 and 0.98. A voltage-reference error would make the
  true/logged ratio swing ~10% with it. Instead it holds at 1.97–2.02 by time
  of day (06–18 h) and by output (0.2–4 kW). The AirCon, at PF ~0.95, fits
  2.01, and 2.08 at low night-time power.
- **The C − A reading is close for a reason.** It has √3× the voltage at 30°
  to C. With the current ~28° from C, C − A reads √3·cos 2° ≈ 1.73 against
  C's cos 28° ≈ 0.88: a ratio of ~1.97. It stops matching when the inverter's
  PF changes.
- **Pool's 2.4 at its old ~100 W duty** is most likely CT inaccuracy at very
  low current. Each 50 A clamp would see under 0.5 A there. At its new
  0.4–1 kW duty, Pool fits 1.99.

What makes only the phase-C clamps see half the current is still unknown, and
needs someone on site. IoTaWatt's own amps can't settle it: both explanations
predict ~10 A for Solar at clipping. Only a reference current, such as a clamp
meter or the inverter's display, can.

---

*28 Sep findings below. The AirCon result holds; the "~0.9 kWh/day unmetered"
item turned out to be Pool reading half.*

**Status (28 Sep 2026):** confirmed. The air-conditioner channel logs
**exactly half** the aircon's real consumption, at every load level (see
[Air conditioner finding](#air-conditioner-finding-25-sep-2026)). The
retailer's half-hourly data confirms it: in night-time slots with the aircon
running (19–21 Sep), retailer import = monitor load + aircon logged. The
control slots with the aircon off match the monitor directly. The phase is
correct (C).

**Device (28 Sep):** an IoTaWatt with derived three-phase enabled and a
single generic VT on phase A. All ten CTs are identical ECS1050s with
identical settings, so a clamp-type mismatch is **ruled out**. Channels on
phase C: AirCon, Solar and Pool. Nicki is on B (reversed); everything else is
on A. The phase A/B channels match the retailer in the control slots. Both
testable phase-C channels need exactly 2×: AirCon (confirmed half-hourly)
and Solar (the long-standing ×2). Pool (phase C, PF 0.48) uses
~0.8 kWh/day, close to the unexplained ~0.9 kWh/day constant, so **possibly
every phase-C channel reads half**. Cause still unknown. At a correct phase
and PF ~0.96, 2× the power requires the clamp to see only half the
circuit's current, so check IoTaWatt's amps for Solar against the
inverter's reported AC current, or use a handheld clamp meter beside the
AirCon CT.

## Air conditioner finding (25 Sep 2026)

Fourteen days of retailer figures (10–23 Sep) were reconciled at 60 s. The
daily shortfall in signed net (retailer − monitor) was regressed against each
circuit's daily kWh. The Air conditioner feed correlates at **r = 1.00**. No
other feed exceeds 0.4 apart from Light 1 (0.81), which also rises on the
hot days.

```
shortfall_kWh = 0.91 + 1.017 × aircon_kWh      RMS residual 0.23 kWh (n = 14)
```

| day | aircon kWh | shortfall kWh | residual |
|----:|-----------:|--------------:|---------:|
| 10–18 Sep (mild) | 0.55–1.83 | 1.05–2.73 | ≤ ±0.43 |
| 19 Sep | 6.26 | 7.23 | −0.05 |
| 20 Sep | 10.04 | 10.94 | −0.18 |
| 21 Sep | 17.95 | 19.10 | −0.06 |
| 22 Sep | 8.72 | 9.62 | −0.15 |
| 23 Sep | 9.15 | 10.72 | +0.50 |
| **8 Sep (held out)** | 2.73 | 3.73 (predicted 3.69) | +0.04 |

Two things are wrong, and the second is small:

1. **The aircon feed shows 50% of the real consumption** (slope ≈ 1.0, so the
   meter sees an extra 1 kWh for every aircon kWh the monitor logs). A generic
   CT under-read would give a few percent, not 50%. Both the aircon and the
   solar inverter are single-phase 230 V units.
   - **Phase settings tested (28 Sep).** The device has one voltage
     reference. Each channel picks a phase (A/B/C) or a line-to-line pair
     (e.g. "C − A", −150°). The solar channel was tested:

     | setting | reading | PF |
     |---|---:|---:|
     | A | +1000 W | 0.81 |
     | B | +100 W | 0.1 |
     | C | −1000 W | 0.89 |
     | **C − A** | **4000 W** | **0.99** |

     The solar channel had been on **phase C with a ×2**. It was moved to
     C − A with no ×2 at ~12:34 on 28 Sep. The C − A voltage is √3·V and sits
     30° from C, so C × 2 ≈ C − A (exactly equal at 30°, since
     2·cos 30° = √3). With the current ~27° from C (PF 0.89 on C), C × 2 reads
     2 × 0.89 = 1.78 vs √3 × 0.99 = 1.71 on C − A, so **the old setting read
     ~4% high**. The logs confirm this: the inverter's clipping plateau
     dropped from 4.32–4.36 kW (24–28 Sep) to 4.10–4.15 kW after the change.
     The old solar history is right to within ~4% (not 2× off). This likely
     explains monitor export running 2–5% above the retailer's.
   - **Solar can't explain the aircon gap.** On 17 Sep solar was 33.0 kWh
     and the gap 1.47 kWh; on 21 Sep solar was 33.3 kWh and the gap
     19.10 kWh. The gap tracks the aircon one-for-one, not solar.
   - **Aircon phase is correct.** Its channel has always been on phase C,
     which reads highest at PF ~0.95. Reversing the channel doesn't change
     the reading, so the device reports magnitude only.
   - **Remaining candidates:**
     - A wrong clamp scale on the aircon channel: its clamp's rating doesn't
       match the clamp type set in the device.
     - An unclamped load that runs one-for-one with the aircon: a second unit,
       or an indoor unit on its own breaker.

     To tell them apart: check the aircon nameplate input power against the
     monitored 2.8 kW peak, check the clamp rating against the device
     setting, and count the aircon breakers.
2. **~0.9 kWh/day (≈ 40 W continuous) of unmetered load.** After removing the
   aircon term, the remainder stays at 0.5–1.6 kWh/day. It doesn't scale with
   total load (31–67 kWh/day), so it's a small always-on circuit with no clamp,
   not a calibration percentage.

With aircon × 2 plus 0.9 kWh/day, every day's signed net lands within ±2% of
the retailer. The exceptions are 15 Sep (+4.1%) and 18 Sep, where net was only
1.07 kWh, so the 0.06 kWh miss shows as 5.6%.

Other checks:

- **Export** reads +0.5% to +11% high every day. That fits an aircon under-read
  during solar hours: the uncounted aircon load becomes phantom export.
- **Bucketing loss** (60 s → 900 s) was 0.02–0.83 kWh/day, symmetric between
  import and export. That's smaller than the 8 Sep estimate.
- **No null samples** on any feed across the 14 days.

The main-tails clamp plan below is still useful as a reference, but it isn't
needed to explain the gap.

---

*Original 8 Sep investigation below. Its "un-metered load / CT under-read"
reading was correct in direction, but the cause turned out to be the aircon.*

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

With an AGL half-hourly export (app → Usage → download), re-fit every channel:

```
node scripts/fit-multipliers.mjs <MyUsageData_dd-mm-yyyy.csv>
```

The script fits the raw logged data, so with the app fix in place it should
keep returning ≈ 2 for the phase-C channels. If the logged scaling changes
again, add a row to both the script's `DEVICE` timeline and
`config.calibration`. That covers an emoncms formula change, a phase setting
change, or a hardware fix on site.

For a single day's totals, run the reconciliation:

```
node scripts/reconcile-day.mjs <YYYY-MM-DD> <providerImportKwh> <providerExportKwh>
```

Track the signed-net percentage over ~2 weeks:

- **stable ratio** → a fixed calibration factor will fix it
- **wandering ratio** → an intermittent un-metered load; hunt for the circuit
  (subboard, hardwired appliance, a breaker with no clamp)
