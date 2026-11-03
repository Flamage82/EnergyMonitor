import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as liveHook from "../hooks/useLiveFeeds";
import * as seriesHook from "../hooks/useSeries";
import type { AsyncState } from "../hooks/usePolledFetch";
import type { GroupBucket } from "../lib/energy";
import type { TodaySeries } from "../hooks/useSeries";
import App from "../App";
import { LiveNow } from "../components/LiveNow";
import { EnergyChart } from "../components/EnergyChart";
import { BillSummary } from "../components/BillSummary";
import { config } from "../config";

const monthState = (data: GroupBucket[]): AsyncState<GroupBucket[]> => ({
  data, error: null, loading: false, lastUpdated: 1,
});

const todayState = (
  data: TodaySeries = { buckets: [], feedBuckets: [] },
): AsyncState<TodaySeries> => ({ data, error: null, loading: false, lastUpdated: 1 });

function mockLive(values: Record<number, number>) {
  vi.spyOn(liveHook, "useLiveFeeds").mockReturnValue({
    data: values, error: null, loading: false, lastUpdated: Date.now(),
  });
}

describe("<LiveNow>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows per-circuit watts and the net import state", () => {
    mockLive({
      384745: 30, 384746: 500, 384747: 260, 384748: 140, 384750: 0,
      384751: 40, 384752: 25, 384754: 5, 384753: -300, 545440: 200,
    });
    render(<LiveNow />);
    expect(screen.getByText("Pool")).toBeInTheDocument();
    // main = 30+500+260+140+0+40+25+5 = 1000; nicki 200; solar 300 -> net 900 import
    expect(screen.getByTestId("net")).toHaveAttribute("data-state", "importing");
  });

  it("counts the unmetered load in the net", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-03T12:00:00+10:00") });
    try {
      // main 100 + nicki 0 − solar 120 = −20 W as metered; +45 W unmetered -> importing 25 W
      mockLive({
        384745: 100, 384746: 0, 384747: 0, 384748: 0, 384750: 0,
        384751: 0, 384752: 0, 384754: 0, 384753: -120, 545440: 0,
      });
      render(<LiveNow />);
      expect(screen.getByTestId("net")).toHaveAttribute("data-state", "importing");
      expect(screen.getByTestId("net")).toHaveTextContent("Importing 25 W");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows exporting when solar exceeds load", () => {
    mockLive({
      384745: 0, 384746: 0, 384747: 0, 384748: 0, 384750: 0,
      384751: 0, 384752: 0, 384754: 0, 384753: -4000, 545440: 100,
    });
    render(<LiveNow />);
    expect(screen.getByTestId("net")).toHaveAttribute("data-state", "exporting");
  });
});

describe("<EnergyChart>", () => {
  // 2026-10-08 15:00 Brisbane; the configured data floor is 2026-10-07 10:00.
  const now = new Date("2026-10-08T05:00:00Z");

  const mockData = () => {
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue(todayState());
    vi.spyOn(seriesHook, "useMonthData").mockReturnValue(monthState([]));
  };

  // Clear before as well as after so this block's isolation doesn't depend on
  // test order (a stray `energychart.range` from elsewhere would flip a default).
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("remembers the selected range in localStorage", () => {
    mockData();
    const { unmount } = render(<EnergyChart now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /this month/i }));
    expect(localStorage.getItem("energychart.range")).toBe("month");
    unmount();
    render(<EnergyChart now={now} />);
    expect(screen.getByRole("button", { name: /this month/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("mounts its own month poll so it can page independently of the bill", () => {
    const monthSpy = vi.spyOn(seriesHook, "useMonthData").mockReturnValue(monthState([]));
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue(todayState());
    render(<EnergyChart now={now} />);
    expect(monthSpy).toHaveBeenCalled();
  });

  it("gives the range toggle an accessible name", () => {
    mockData();
    render(<EnergyChart now={now} />);
    expect(screen.getByRole("group", { name: "Chart range" })).toBeInTheDocument();
  });

  it("remembers the by-load view and restores it as the pressed button", () => {
    mockData();
    const { unmount } = render(<EnergyChart now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /by load/i }));
    expect(localStorage.getItem("energychart.range")).toBe("loads");
    unmount();
    render(<EnergyChart now={now} />);
    expect(screen.getByRole("button", { name: /by load/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("heads the section with the current day and disables step-forward at the live edge", () => {
    mockData();
    render(<EnergyChart now={now} />);
    expect(screen.getByRole("heading", { name: /Usage/ })).toHaveTextContent("Today");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });

  it("pages back a day, then stops at the data-start floor", () => {
    mockData();
    render(<EnergyChart now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("heading", { name: /Usage/ })).toHaveTextContent(/Wed.*7.*Oct/);
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    // Oct 7 holds the configured floor — no earlier day to page to.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("keeps the day offset when toggling between Today and By load", () => {
    mockData();
    render(<EnergyChart now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    fireEvent.click(screen.getByRole("button", { name: /by load/i }));
    expect(screen.getByRole("heading", { name: /Usage/ })).toHaveTextContent(/Wed.*7.*Oct/);
  });

  it("pages the month view by whole months and labels it", () => {
    mockData();
    localStorage.setItem("energychart.range", "month");
    render(<EnergyChart now={now} />);
    expect(screen.getByRole("heading", { name: /Usage/ })).toHaveTextContent("October 2026");
    // No prior month has data, and October is the live month.
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("<BillSummary>", () => {
  // `now` is 15 Oct; the configured data floor is 7 Oct 10:00, so September is
  // before monitoring and October is the earliest month worth paging to.
  const now = new Date("2026-10-15T05:00:00Z");
  const buckets: GroupBucket[] = [
    { tMs: Date.parse("2026-10-08T14:00:00Z"), mainW: 1000, nickiW: 500, solarW: 200, partial: false },
  ];
  const mockMonth = (data: GroupBucket[] = buckets) =>
    vi.spyOn(seriesHook, "useMonthData").mockReturnValue(monthState(data));

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a total for each household", () => {
    mockMonth();
    render(<BillSummary now={now} />);
    expect(screen.getByTestId("bill-main")).toHaveTextContent("$");
    expect(screen.getByTestId("bill-nicki")).toHaveTextContent("$");
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });

  it("notes the excluded pre-monitoring days when the data floor is in effect", () => {
    mockMonth();
    render(<BillSummary now={now} />);
    expect(
      screen.getByText(/Excludes usage before 7 Oct, 10:00\s?am \(before monitoring was corrected\)\./),
    ).toBeInTheDocument();
  });

  it("reports data gaps from partial buckets", () => {
    mockMonth([{ ...buckets[0], partial: true }]);
    render(<BillSummary now={now} />);
    expect(screen.getByText(/1 data gap\./)).toBeInTheDocument();
  });

  it("starts at the live month with step-forward disabled", () => {
    const monthSpy = mockMonth();
    render(<BillSummary now={now} />);
    expect(screen.getByRole("heading", { name: /Bill/ })).toHaveTextContent("Bill so far — October 2026");
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
    expect(monthSpy).toHaveBeenLastCalledWith(now, 0);
  });

  it("pages back a whole month, then stops at the data-start floor", () => {
    // 3 Nov: October is complete and holds the floor, so there is nothing earlier.
    const nov = new Date("2026-11-03T05:00:00Z");
    const monthSpy = mockMonth();
    render(<BillSummary now={nov} />);
    expect(screen.getByRole("button", { name: "Previous month" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    expect(monthSpy).toHaveBeenLastCalledWith(nov, -1);
    expect(screen.getByRole("heading", { name: /Bill/ })).toHaveTextContent("Bill — October 2026");
    expect(screen.getByTestId("bill-main")).toHaveTextContent("Total");
    expect(screen.getByTestId("bill-main")).not.toHaveTextContent("Running total");
    expect(screen.getByRole("button", { name: "Previous month" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: /Bill/ })).toHaveTextContent("Bill so far — November 2026");
  });

  it("charges a past month's supply for its full length", () => {
    // Full November (30 days) at the configured supply rate, no usage data.
    const dec = new Date("2026-12-03T05:00:00Z");
    mockMonth([]);
    render(<BillSummary now={dec} />);
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    const supplyDollars = (config.tariff.supplyChargeCentsPerDay * 30) / 100;
    const total = screen.getByTestId("bill-main").textContent ?? "";
    const nicki = screen.getByTestId("bill-nicki").textContent ?? "";
    const share = (n: number) => (supplyDollars * n) / (config.shares.mainHouse + config.shares.nicki);
    expect(total).toContain(`$${share(config.shares.mainHouse).toFixed(2)}`);
    expect(nicki).toContain(`$${share(config.shares.nicki).toFixed(2)}`);
  });
});

describe("<App>", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the header and all three sections", () => {
    vi.spyOn(liveHook, "useLiveFeeds").mockReturnValue({
      data: {}, error: null, loading: false, lastUpdated: Date.now(),
    });
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue(todayState());
    vi.spyOn(seriesHook, "useMonthData").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Marburg Energy" })).toBeInTheDocument();
    expect(screen.getByText("Right now")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Usage/ })).toBeInTheDocument();
    expect(screen.getByText(/Bill so far/)).toBeInTheDocument();
  });
});
