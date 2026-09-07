export interface FeedGroups { main: number[]; nicki: number[]; solar: number[]; }
export interface Tariff {
  importCentsPerKwh: number;
  supplyChargeCentsPerDay: number;
  feedInCentsPerKwh: number;
}
export interface Shares { mainHouse: number; nicki: number; }
export type SolarAllocation = "proportional" | "mainHouseFirst";

export type MultiFeedSeries = { feedid: string; data: [number, number | null][] }[];

export interface GroupBucket {
  tMs: number;
  mainW: number;
  nickiW: number;
  solarW: number; // >= 0 when generating
  partial: boolean;
}

export function integrateKwh(watts: number, bucketSeconds: number): number {
  return (watts * bucketSeconds) / 3_600_000;
}

export function buildBuckets(series: MultiFeedSeries, groups: FeedGroups): GroupBucket[] {
  const byId = new Map(series.map((s) => [Number(s.feedid), s.data]));
  const all = [...groups.main, ...groups.nicki, ...groups.solar];
  const length = Math.max(0, ...all.map((id) => byId.get(id)?.length ?? 0));

  const sumGroup = (ids: number[], i: number) => {
    let sum = 0;
    let missing = false;
    for (const id of ids) {
      const point = byId.get(id)?.[i];
      const v = point?.[1];
      if (v == null) missing = true;
      else sum += v;
    }
    return { sum, missing };
  };

  const out: GroupBucket[] = [];
  for (let i = 0; i < length; i++) {
    const main = sumGroup(groups.main, i);
    const nicki = sumGroup(groups.nicki, i);
    const solar = sumGroup(groups.solar, i);
    const tMs =
      byId.get(all[0])?.[i]?.[0] ??
      byId.get(groups.main[0])?.[i]?.[0] ??
      0;
    out.push({
      tMs,
      mainW: main.sum,
      nickiW: nicki.sum,
      solarW: -solar.sum, // feed is negative when generating
      partial: main.missing || nicki.missing || solar.missing,
    });
  }
  return out;
}

export interface HouseholdBill {
  importKwh: number;
  importCost: number;       // dollars
  solarCreditShare: number; // dollars, <= 0
  supplyChargeShare: number;// dollars
  total: number;            // dollars
}
export interface BillResult { mainHouse: HouseholdBill; nicki: HouseholdBill; gaps: number; }

interface AllocateOpts {
  bucketSeconds: number;
  tariff: Tariff;
  shares: Shares;
  solarAllocation: SolarAllocation;
  daysElapsed: number;
}

export function allocateBill(buckets: GroupBucket[], opts: AllocateOpts): BillResult {
  const { bucketSeconds, tariff, shares, solarAllocation, daysElapsed } = opts;
  const importRate = tariff.importCentsPerKwh / 100;
  const fitRate = tariff.feedInCentsPerKwh / 100;
  const totalShares = shares.mainHouse + shares.nicki;

  const main = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  const nicki = { importKwh: 0, importCost: 0, solarCreditShare: 0 };
  let gaps = 0;

  for (const b of buckets) {
    if (b.partial) gaps++;
    const gross = b.mainW + b.nickiW;
    const netW = gross - b.solarW;

    if (netW >= 0) {
      const netKwh = integrateKwh(netW, bucketSeconds);
      if (solarAllocation === "proportional") {
        const mainShare = gross > 0 ? b.mainW / gross : 0.5;
        main.importKwh += netKwh * mainShare;
        nicki.importKwh += netKwh * (1 - mainShare);
      } else {
        const mainNetW = Math.max(0, b.mainW - b.solarW);
        const solarLeft = Math.max(0, b.solarW - b.mainW);
        const nickiNetW = Math.max(0, b.nickiW - solarLeft);
        main.importKwh += integrateKwh(mainNetW, bucketSeconds);
        nicki.importKwh += integrateKwh(nickiNetW, bucketSeconds);
      }
    } else {
      const exportKwh = integrateKwh(-netW, bucketSeconds);
      const credit = exportKwh * fitRate;
      main.solarCreditShare -= (credit * shares.mainHouse) / totalShares;
      nicki.solarCreditShare -= (credit * shares.nicki) / totalShares;
    }
  }

  main.importCost = main.importKwh * importRate;
  nicki.importCost = nicki.importKwh * importRate;

  const supplyTotal = (daysElapsed * tariff.supplyChargeCentsPerDay) / 100;
  const mainSupply = (supplyTotal * shares.mainHouse) / totalShares;
  const nickiSupply = (supplyTotal * shares.nicki) / totalShares;

  const finish = (h: typeof main, supply: number): HouseholdBill => ({
    ...h,
    supplyChargeShare: supply,
    total: h.importCost + h.solarCreditShare + supply,
  });

  return {
    mainHouse: finish(main, mainSupply),
    nicki: finish(nicki, nickiSupply),
    gaps,
  };
}
