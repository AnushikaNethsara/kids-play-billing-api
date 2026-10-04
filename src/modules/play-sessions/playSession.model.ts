import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import {
  DEFAULT_SESSION_PRICING_MODE,
  SessionPricingMode,
  type TieredPricing,
} from '../../common/constants/pricingModes';
import {
  resolveTieredPricing,
  tieredPricingSchema,
} from '../play-packages/tieredPricing.schema';

/**
 * A product sold onto a child who is playing - socks, typically handed over at the gate.
 * Charged at checkout as a PRODUCT line on the session's bill rather than as a bill of its
 * own, because the money is taken once, when the family leaves.
 *
 * The name and price are snapshotted when the extra is added, the same rule as the play
 * rate: a price edit mid-visit never changes what this child's socks cost.
 */
export interface PlaySessionExtraSubdocument {
  /**
   * Generated on the device that added the extra. The idempotency key for a retried sync:
   * an add whose `localId` is already on the session is a no-op, not a second pair.
   */
  localId: string;
  productId: Types.ObjectId;
  productName: string;
  unitPrice: number;
  quantity: number;
  addedAt: Date;
  addedByCashierId: Types.ObjectId;
  addedByCashierName: string;
}

export interface PlaySessionDocument {
  /**
   * The value encoded in the printed QR ticket. Generated on the cashier's device so a
   * check-in works with no network, which also makes it the natural idempotency key:
   * the unique index below turns a retried sync into a no-op instead of a duplicate.
   */
  ticketCode: string;
  status: PlaySessionStatus;
  childName: string;

  // Rate snapshot, taken at check-in. A later price change must never rewrite what an
  // already-playing child is charged - same discipline as BillItemSubdocument. These five
  // fields are the complete input to pricing: a checkout needs nothing else, which is what
  // lets the cashier app quote a session correctly with no network.
  playPackageId: Types.ObjectId;
  packageName: string;
  /**
   * Under PRORATA the rate denominator: `unitPrice` buys this many minutes of play. Under
   * BLOCK_WITH_GRACE the block length: each started block costs `unitPrice` in full.
   */
  rateDurationMinutes: number;
  unitPrice: number;
  pricingMode: SessionPricingMode;
  /** Always 0 on a PRORATA session, where grace means nothing. */
  graceMinutes: number;
  /** The hourly rates, overtime and rounding. Set only on a TIERED_HOURLY session. */
  tieredPricing: TieredPricing | null;

  customerId: Types.ObjectId | null;
  parentName: string;
  phoneNumber: string;

  /**
   * Supplied by the device, because an offline check-in has no server round trip to be
   * timed by. `checkInRecordedAt` is the server's own clock at the moment it first saw
   * this session, and is the anchor for auditing a device whose clock is wrong.
   */
  checkInAt: Date;
  checkInRecordedAt: Date;
  checkOutAt: Date | null;
  /** Frozen at checkout so the bill and the session can never disagree afterwards. */
  billedMinutes: number | null;
  /**
   * The line total this session was billed at, frozen at checkout beside `billedMinutes`.
   *
   * Stored rather than recomputed because the dashboard's session metrics read this
   * collection directly, and re-expressing two pricing models in an aggregation pipeline
   * would be a third copy of the rules in the least testable language available. Null on
   * every session closed before this existed, which the pipeline falls back for.
   */
  chargedAmount: number | null;
  billId: Types.ObjectId | null;

  checkInCashierId: Types.ObjectId;
  checkInCashierName: string;
  checkOutCashierId: Types.ObjectId | null;
  checkOutCashierName: string | null;

  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  voidReason: string | null;

  /** Products sold onto this visit, billed at checkout. Absent on older sessions. */
  extras: PlaySessionExtraSubdocument[];

  /**
   * Mirrors `isTestBill` on the bill this session was checked out into. The session
   * metrics on the dashboard (play hours, occupancy, revenue per play hour) read this
   * collection directly rather than going through the bill, so the flag has to be
   * denormalised here or a test checkout would keep showing up in those numbers. It is
   * only ever written by the bill service, in the same operation that flags the bill.
   */
  isTestBill: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type PlaySessionHydrated = HydratedDocument<PlaySessionDocument>;

const playSessionExtraSchema = new Schema<PlaySessionExtraSubdocument>(
  {
    localId: { type: String, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    addedAt: { type: Date, required: true },
    addedByCashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    addedByCashierName: { type: String, required: true },
  },
  { _id: false },
);

const playSessionSchema = new Schema<PlaySessionDocument>(
  {
    ticketCode: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(PlaySessionStatus),
      default: PlaySessionStatus.ACTIVE,
    },
    childName: { type: String, required: true, trim: true },

    playPackageId: { type: Schema.Types.ObjectId, ref: 'PlayPackage', required: true },
    packageName: { type: String, required: true },
    rateDurationMinutes: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    pricingMode: {
      type: String,
      enum: Object.values(SessionPricingMode),
      default: DEFAULT_SESSION_PRICING_MODE,
    },
    graceMinutes: { type: Number, default: 0, min: 0 },
    tieredPricing: { type: tieredPricingSchema, default: null },

    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    parentName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },

    checkInAt: { type: Date, required: true },
    checkInRecordedAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    billedMinutes: { type: Number, default: null },
    chargedAmount: { type: Number, default: null },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },

    checkInCashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    checkInCashierName: { type: String, required: true },
    checkOutCashierId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkOutCashierName: { type: String, default: null },

    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: null },

    extras: { type: [playSessionExtraSchema], default: [] },

    isTestBill: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// The ticket code is both the QR payload and the check-in idempotency key, so this
// uniqueness is load-bearing rather than merely tidy.
playSessionSchema.index({ ticketCode: 1 }, { unique: true });
// The "currently playing" board - the most frequently run query in the system.
playSessionSchema.index({ status: 1, checkInAt: -1 });
// Finding a family's ticket when the printed slip has been lost.
playSessionSchema.index({ phoneNumber: 1 });
// Session history listings.
playSessionSchema.index({ checkInAt: -1 });
// Reopening sessions when their bill is cancelled.
playSessionSchema.index({ billId: 1 });

/**
 * The session's rate snapshot, read defensively, in the shape `priceSession` expects.
 *
 * Sessions opened before pricing modes existed carry neither field. Mongoose fills the
 * schema default on hydration, but this must also hold for a `.lean()` read, where the
 * raw BSON simply has no such key - so the fallback is applied here rather than trusted.
 */
export function resolveSessionRate(
  session: Pick<PlaySessionDocument, 'unitPrice' | 'rateDurationMinutes'> &
    Partial<Pick<PlaySessionDocument, 'pricingMode' | 'graceMinutes' | 'tieredPricing'>>,
): {
  pricingMode: SessionPricingMode;
  unitPrice: number;
  rateDurationMinutes: number;
  graceMinutes: number;
  tieredPricing: TieredPricing | null;
} {
  const tieredPricing = resolveTieredPricing(session);
  let pricingMode: SessionPricingMode = DEFAULT_SESSION_PRICING_MODE;
  if (session.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE) {
    pricingMode = SessionPricingMode.BLOCK_WITH_GRACE;
  } else if (session.pricingMode === SessionPricingMode.TIERED_HOURLY && tieredPricing) {
    // A tiered session without its rates cannot be priced as tiered. Validation never lets
    // one be saved; if one appears anyway, it prices pro-rata at the 1st-hour rate.
    pricingMode = SessionPricingMode.TIERED_HOURLY;
  }

  const hasGrace = pricingMode !== SessionPricingMode.PRORATA;

  return {
    pricingMode,
    unitPrice: session.unitPrice,
    rateDurationMinutes: session.rateDurationMinutes,
    // Grace is meaningless under PRORATA, so it is never carried into one.
    graceMinutes:
      hasGrace && Number.isFinite(session.graceMinutes)
        ? Math.max(session.graceMinutes as number, 0)
        : 0,
    tieredPricing: pricingMode === SessionPricingMode.TIERED_HOURLY ? tieredPricing : null,
  };
}

/** What the extras on a session add up to. Tolerates sessions predating extras. */
export function sumSessionExtras(session: { extras?: PlaySessionExtraSubdocument[] | null }): number {
  return (session.extras ?? []).reduce((sum, extra) => sum + extra.unitPrice * extra.quantity, 0);
}

export const PlaySessionModel = model<PlaySessionDocument>('PlaySession', playSessionSchema);
