# Handoff: check the VT calibration (20.65) against fresh AGL data

Written 19 Oct 2026, at the end of a long session. This file is **not
committed**. When the work is done, fold the results into
[`docs/metering-accuracy.md`](metering-accuracy.md) and delete this file.

The background is in `docs/metering-accuracy.md`. The sections that matter
most are **AGL re-check and the bill switch (19 Oct 2026)** and **VT
calibration changes and the 20.65 setting**.

## What the user will do

About a week after 19 Oct, the user will download half-hourly usage from the
AGL app. It arrives as a zip in `C:\Users\flama\Downloads\`, or already
extracted to a folder. Last time the file was
`Downloads\MyUsageData_19-10-2026\MyUsageData_18-10-2026.csv`.

- Rows are 30-min reads.
- `RateTypeDescription`: `Generalusage` is import, `Solar` is export.
- `ProfileReadValue` is kWh.
- `StartDate` is `dd/mm/yyyy hh:mm:ss AM`, Brisbane time (UTC+10, no DST).
- The file covers about a year, up to the day before the download.

## Your tasks

1. **Run the fit from the VT change:**
   `node scripts/fit-multipliers.mjs <csv> 2026-10-19T10:00`.
   It reads through the Worker, so it doesn't need the API key. Use only
   *full days* (20 Oct on) in the daily figures. Read these lines:
   - **"Global factor … → VT cal X"** is the main question. Expect ≈×1.00
     (VT cal ≈20.65).
   - **"Integrator (bill) vs AGL"** gives the bill's import and export error.
     The two-way-volume line checks the split. Last time the two-way volumes
     matched (10.14 vs 10.15 kWh).
   - **The per-channel fit:** phase C has been fitting ≈1.96 relative to its
     ×2 (AirCon 1.976, Pool 1.956, Solar 1.959, 9–17 Oct); phase A and Nicki
     ≈1.00. Report it if it moves.
   - **Ignore the free fit's leave-one-day-out RMS.** It blows up (1311 Wh
     last time) because Light 1 (~1 W) can't be pinned down.
2. **Compare with the 9–17 Oct baseline** below, then report to the user in
   plain terms: did 20.65 help, and by how much?
3. **If the global factor is off by more than ~0.5%:** discuss it with the
   user before doing anything. The fix is another VT cal trim on the IoTaWatt,
   which the user makes, and the cal it implies is `VT_NOW × factor`. Then:
   - **Ask the user for the exact time of the change.** Don't infer it from
     the voltage feed (see the gotchas).
   - Set `VT_NOW` and add a `DEVICE` row in `scripts/fit-multipliers.mjs`:
     a `skip` for the half-hour containing the change, then the new `vt` from
     the next half-hour.
   - The right value drifted ~0.8% within a month (≈20.5 fitted ×1.00 in
     Sep; 20.65 fitted in Oct). If it moves again, say so. A drifting value
     tells us more than another trim does.
4. **Don't propose per-phase factors or a constant offset.** Both fitted
   better in-sample on 9–17 Oct but failed on unseen days (table below). If
   the user asks for them again, re-run that transfer test on the new data
   first.
5. **Write up** the results in `docs/metering-accuracy.md`, delete this file,
   then commit and push.

## Baseline: what 20.65 was chosen on

All figures are against AGL. "Daily error" is the mean |monitor net − AGL
net| per full day.

**9–17 Oct**, logged at 20.5, rescaled by the script to 20.65 (8 full days):

| | value |
|---|---|
| global factor | ×1.0003 → VT cal 20.66 |
| daily error, leave-one-day-out | 0.68 kWh |
| bill import (integrator) | 420.5 vs 424.9 kWh (−1.0%) |
| bill export (integrator) | 18.6 vs 17.6 kWh (+5.8%) |

**Candidates fitted on 9–17 Oct**, then tested on 7 Oct 10:00 – 9 Oct 08:00
(logged at cal 21, unseen by the fit):

| candidate | 9–17 Oct daily error (leave-one-day-out) | 7–9 Oct, unseen |
|---|---:|---:|
| none | 0.92 kWh | 0.40 kWh |
| **global ×1.0076 (= VT cal 20.65)** | 0.71 | **0.08** |
| A & B ×1.027, C ×0.984 | 0.40 | 0.86 |
| constant +41 W | 0.40 | 0.69 |

The analysis scripts behind this table were scratch files and are gone. The
method:
1. Fetch the 10 circuits plus Imports/Exports at 900 s from emoncms.
2. Group them into phase sums A, B, C per half-hour.
3. OLS of AGL net (mean W) on the candidate's terms.
4. Score leave-one-day-out, then apply the fitted factors (÷ 21/20.5) to the
   cal-21 window.

Before 7 Oct the gap had a shape by time of day: ~10 W at 00–06 h, 64–81 W
at 09–12 h, ~21 W at 15 h, 45–55 W at 18–24 h. Check whether that shape is
still there after the cal change.

## Facts you'll need

**The bill now uses the IoTaWatt integrator feeds** (commit `4f350c2`,
deployed).

- **Config:** `gridFeeds` in `app/src/config.ts` names Imports and Exports.
- **Split:** `gridFlowW` in `app/src/lib/energy.ts` gives each 15-min bucket
  its import and export, both ≥ 0. Where the integrator feeds have no value,
  it falls back to netting the circuit sum.
- **House shares:** `allocateBill` splits import between the houses by
  `mainW / gross`. A bucket can now both import and export.
- **Month chart:** `toMonthDayPoints` uses the same `gridFlowW`.
- **Month query:** the month query fetches the two extra feeds; the day chart
  doesn't.
- **Worker:** `FEED_IDS` already includes 546960–546962, and that version is
  deployed.
- **Calibration:** `config.calibration` has no entries for the integrator
  feeds, so they stay ×1. The VT cal changes are **not** corrected in the
  app: the bill since 7 Oct 10:00 carries them. The user agreed, since the
  difference is under $1.

**IoTaWatt and emoncms** (node "ByteCreep"):

- **Posting:** the IoTaWatt posts every 30 s into 5 s slots, so most slots
  are null. Always request with `average=1`.
- **Phase C ×2:** since 7 Oct 09:29, the IoTaWatt's emoncms output formulas
  double AirCon, Pool and Solar. Those channels log half their real power;
  the cause is unknown and needs someone on site. The integrator formula has
  the same ×2s:
  Light1 + Light2 + Power1 + Power2 + Oven + HSTP + Nicki + 2×AirCon + 2×Pool + 2×Solar.
  Solar is *added* because it's negative while generating.
- **One VT, on phase A.** B and C are derived from it, so the VT cal scales
  every channel equally. The user notes that B and C voltages are only
  assumed, which is a fair point; see task 4 for why no per-phase fix.
- **VT cal history**, from steps in the Voltage feed (384743). It's encoded
  in the fit script's `DEVICE` table (`vt`, rescaled to `VT_NOW = 20.65`):

  | from | VT cal |
  |---|---|
  | until 4 Oct 12:40 | ≈20.5 (assumed; voltage ~241 V) |
  | 4 Oct 12:40 | 21 |
  | 9 Oct 08:15–09:06, several steps (skipped) | 20.5 |
  | 19 Oct ~09:40 (user-confirmed) | 20.65 |

| feed | id | phase / note |
|---|---|---|
| Voltage | 384743 | VT on phase A |
| Light 1 | 384745 | A |
| Power 1 | 384746 | A |
| Light 2 | 384747 | A |
| Power 2 | 384748 | A |
| Oven | 384750 | A |
| HSTP (water treatment) | 384751 | A, flat ~45–50 W |
| Air conditioner | 384752 | C |
| Solar | 384753 | C, negative when generating |
| Pool | 384754 | C, heater running since 4 Oct |
| Nicki | 545440 | B, her household |
| Net | 546960 | integrator; equals the circuit sum |
| Imports | 546961 | integrator, ≥ 0, average W per post |
| Exports | 546962 | integrator, **negative**, average W per post |

The integrator feeds carry average watts even though their unit says "Wh".
Treat them like the circuits: mean W × hours = Wh.

## Gotchas

- **API key:** the emoncms key is in `C:\Dropbox\EmonCmsApiKey.txt`.
  - Never print or Read it.
  - Load it with `KEY=$(tr -d '[:space:]\r\n' < /c/Dropbox/EmonCmsApiKey.txt)`.
  - Send it as `Authorization: Bearer $KEY` to
    `https://emoncms.org/feed/data.json`.
  - Pipe all output through `sed "s/$KEY/REDACTED/g"`.
  - `feed/list.json` lists the feeds.
- **Voltage-feed noise:** at 30 s the voltage wobbles ±1% (≈2 V). A small
  cal step, like 20.5 → 20.65 (+0.73%), can't be dated from the feed alone.
  Last session mistook a 09:30 wobble for the change.
- **Trailing nulls:** nulls at the very end of a query are posts that haven't
  arrived yet, not an IoTaWatt restart.
- **Worker `/series` limits:**
  - It needs the header `Origin: https://flamage82.github.io`.
  - It allows a span of at most 40 days.
  - It **silently coarsens** the interval above ~100k points (span × feeds).
  - It returns feeds sorted by ID; look them up by `feedid`.
- **Data before 8 Sep 2026 is unusable** for calibration: the setup was
  different then.
- **Bash restrictions:** the user's hook blocks standalone `cat`, `head`,
  `sed`, `grep` and `awk`. Use the Read and Grep tools or `node -e`. Piping
  *into* them is fine.
- **Line endings:** several docs are CRLF, so multi-line Edit matches can
  fail. Edit one line at a time.
- **vite-node** won't run scripts from outside `app/` (Vite's fs allow-list).
  Copy them into `app/` temporarily, then delete them.
- **Building the app:**
  `VITE_WORKER_URL=https://marburg-energy-proxy.bytecreep.workers.dev npm run build`.
- **Tests:** `cd app && npx vitest run` and `npx tsc -b`; there are 104
  tests, all passing.

## Conventions and user preferences

- **Git:** commit and push straight to `main`, with no branches or PRs. Run
  the tests first. Pushing deploys the app via GitHub Pages. The Worker
  deploys separately: `cd worker && npx wrangler deploy`.
- **The user is off-site.** Don't suggest clamp-meter, amps or inverter
  checks.
- **Wiring:** the user is firm that AirCon and Solar are single-phase 230 V.
  Don't argue it.
- **What the user wants:** improvement, not perfection. Keep recommendations
  practical.
- **Show the numbers:** the user pushes back on hand-waving ("so are you
  saying…?"), so back each claim with numbers and say plainly when something
  is uncertain.

## Later (not for this round)

- **On-site fix:** finding why the phase-C clamps see half the current needs
  someone on site. If it's fixed:
  - Set the IoTaWatt output formulas *and* the integrator formula back to ×1.
  - Add a `DEVICE` row in the fit script and a step in `config.calibration`.
- **Remove the calibration:** once the day chart's floor no longer reaches
  back before 7 Oct 09:29, `config.calibration` can go.
- **Extra VTs:** the IoTaWatt supports more VT inputs, so B and C voltages
  could be measured instead of assumed. That needs an on-site visit.
