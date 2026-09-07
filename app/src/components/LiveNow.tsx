import { config } from "../config";
import { useLiveFeeds } from "../hooks/useLiveFeeds";
import { Section } from "./Section";

const sum = (v: Record<number, number>, ids: number[]) => ids.reduce((a, id) => a + (v[id] ?? 0), 0);
const w = (n: number) => `${Math.round(n).toLocaleString("en-AU")} W`;

export function LiveNow() {
  const { data, error, lastUpdated } = useLiveFeeds();
  const v = data ?? {};
  const main = sum(v, config.feeds.main);
  const nicki = sum(v, config.feeds.nicki);
  const solarGen = -sum(v, config.feeds.solar);
  const net = main + nicki - solarGen;
  const stale = lastUpdated != null && Date.now() - lastUpdated > 120_000;

  return (
    <Section title="Right now" error={error}>
      {stale ? <p className="note">data delayed</p> : null}
      <div className="live-headline">
        <div><span className="label">Main house</span><strong>{w(main)}</strong></div>
        <div><span className="label">Nicki</span><strong>{w(nicki)}</strong></div>
        <div><span className="label">Solar</span><strong>{solarGen > 20 ? w(solarGen) : "idle"}</strong></div>
      </div>
      <p className="net" data-testid="net" data-state={net >= 0 ? "importing" : "exporting"}>
        {net >= 0 ? `Importing ${w(net)}` : `Exporting ${w(-net)}`}
      </p>
      <ul className="circuits">
        {config.allFeedIds.map((id) => (
          <li key={id}>
            <span>{config.feedLabels[id]}</span>
            <span>{w(config.feeds.solar.includes(id) ? -(v[id] ?? 0) : (v[id] ?? 0))}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
