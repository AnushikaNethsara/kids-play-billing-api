/**
 * What a bill line is for. Every line used to be a child playing a package, and every
 * line written before this existed carries no `kind` at all - which is why a missing kind
 * always reads as PLAY, and why no data migration was needed to introduce the others.
 *
 * - PLAY: a child on a play package, flat-price or timed from a play session.
 * - GROUP: a negotiated visit by a group (a pre-school, a party). `unitPrice` is the agreed
 *   rate per child per hour, `quantity` is the headcount and `visitMinutes` the length of
 *   the visit, so the line is `round(unitPrice x quantity x visitMinutes / 60)`.
 * - PRODUCT: something sold over the counter, such as socks. `unitPrice x quantity`.
 * - SUBSCRIPTION: a monthly subscription sold to a family - a bundle of visit credits.
 *   `unitPrice` is the plan price, `quantity` is always 1. Paying the bill activates the
 *   subscription; see docs/subscriptions.md.
 */
export const BillItemKind = {
  PLAY: 'PLAY',
  GROUP: 'GROUP',
  PRODUCT: 'PRODUCT',
  SUBSCRIPTION: 'SUBSCRIPTION',
} as const;

export type BillItemKind = (typeof BillItemKind)[keyof typeof BillItemKind];

/**
 * Reads a line's kind defensively. An aggregation or a `.lean()` read sees the raw BSON,
 * where a line written before kinds existed simply has no such key.
 */
export function resolveItemKind(item: { kind?: string | null }): BillItemKind {
  switch (item.kind) {
    case BillItemKind.GROUP:
    case BillItemKind.PRODUCT:
    case BillItemKind.SUBSCRIPTION:
      return item.kind;
    default:
      return BillItemKind.PLAY;
  }
}

/** The rate denominator of a group line: its `unitPrice` is per child per this many minutes. */
export const GROUP_RATE_MINUTES = 60;
