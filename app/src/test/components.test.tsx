import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as liveHook from "../hooks/useLiveFeeds";
import * as seriesHook from "../hooks/useSeries";
import type { AsyncState } from "../hooks/usePolledFetch";
import type { GroupBucket } from "../lib/energy";
import App from "../App";
import { LiveNow } from "../components/LiveNow";
import { EnergyChart } from "../components/EnergyChart";
import { BillSummary } from "../components/BillSummary";

const monthState = (data: GroupBucket[]): AsyncState<GroupBucket[]> => ({
  data, error: null, loading: false, lastUpdated: 1,
});

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
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("remembers the selected range in localStorage", () => {
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    const { unmount } = render(<EnergyChart month={monthState([])} />);
    fireEvent.click(screen.getByRole("button", { name: /month/i }));
    expect(localStorage.getItem("energychart.range")).toBe("month");
    unmount();
    render(<EnergyChart month={monthState([])} />);
    expect(screen.getByRole("button", { name: /month/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("does not mount its own month poll (App owns it)", () => {
    const monthSpy = vi.spyOn(seriesHook, "useMonthData");
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    render(<EnergyChart month={monthState([])} />);
    expect(monthSpy).not.toHaveBeenCalled();
  });
});

describe("<BillSummary>", () => {
  // `now` and the month data are both props now — App owns the single
  // useMonthData mount — so no fake clock or hook spy is needed.
  const now = new Date("2026-09-15T05:00:00Z");
  const buckets: GroupBucket[] = [
    { tMs: Date.parse("2026-09-08T14:00:00Z"), mainW: 1000, nickiW: 500, solarW: 200, partial: false },
  ];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a total for each household", () => {
    render(<BillSummary now={now} month={monthState(buckets)} />);
    expect(screen.getByTestId("bill-main")).toHaveTextContent("$");
    expect(screen.getByTestId("bill-nicki")).toHaveTextContent("$");
    expect(screen.getByText(/estimate/i)).toBeInTheDocument();
  });

  it("notes the data-floor window when the floor is in effect", () => {
    render(<BillSummary now={now} month={monthState(buckets)} />);
    expect(screen.getByText(/Covers 2026-09-07 onwards/)).toBeInTheDocument();
  });

  it("reports data gaps from partial buckets", () => {
    render(
      <BillSummary
        now={now}
        month={monthState([{ ...buckets[0], partial: true }])}
      />,
    );
    expect(screen.getByText(/1 data gap\./)).toBeInTheDocument();
  });

  it("does not mount its own month poll (App owns it)", () => {
    const monthSpy = vi.spyOn(seriesHook, "useMonthData");
    render(<BillSummary now={now} month={monthState(buckets)} />);
    expect(monthSpy).not.toHaveBeenCalled();
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
    vi.spyOn(seriesHook, "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    vi.spyOn(seriesHook, "useMonthData").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Marburg Energy" })).toBeInTheDocument();
    expect(screen.getByText("Right now")).toBeInTheDocument();
    expect(screen.getByText("Usage")).toBeInTheDocument();
    expect(screen.getByText(/Bill so far/)).toBeInTheDocument();
  });
});
