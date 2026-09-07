import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as liveHook from "../hooks/useLiveFeeds";
import * as todayHook from "../hooks/useSeries";
import { LiveNow } from "../components/LiveNow";
import { EnergyChart } from "../components/EnergyChart";

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
    vi.spyOn(todayHook, "useTodaySeries").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    vi.spyOn(todayHook, "useMonthData").mockReturnValue({ data: [], error: null, loading: false, lastUpdated: 1 });
    const { unmount } = render(<EnergyChart />);
    fireEvent.click(screen.getByRole("button", { name: /month/i }));
    expect(localStorage.getItem("energychart.range")).toBe("month");
    unmount();
    render(<EnergyChart />);
    expect(screen.getByRole("button", { name: /month/i })).toHaveAttribute("aria-pressed", "true");
  });
});
