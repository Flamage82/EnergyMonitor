export const FEED_IDS = [
  384745, 384746, 384747, 384748, 384750, 384751, 384752, 384753, 384754, 545440,
  // IoTaWatt integrator: Net, Imports (>= 0), Exports (<= 0), split at sample rate.
  546960, 546961, 546962,
] as const;
export type FeedId = (typeof FEED_IDS)[number];
