import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';
import {
  DEFAULT_SESSION_PRICING_MODE,
  SessionPricingMode,
} from '../../common/constants/pricingModes';

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
    Partial<Pick<PlaySessionDocument, 'pricingMode' | 'graceMinutes'>>,
): {
  pricingMode: SessionPricingMode;
  unitPrice: number;
  rateDurationMinutes: number;
  graceMinutes: number;
} {
  const pricingMode =
    session.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE
      ? SessionPricingMode.BLOCK_WITH_GRACE
      : DEFAULT_SESSION_PRICING_MODE;

  return {
    pricingMode,
    unitPrice: session.unitPrice,
    rateDurationMinutes: session.rateDurationMinutes,
    // Grace is meaningless under PRORATA, so it is never carried into one.
    graceMinutes:
      pricingMode === SessionPricingMode.BLOCK_WITH_GRACE && Number.isFinite(session.graceMinutes)
        ? Math.max(session.graceMinutes as number, 0)
        : 0,
  };
}

export const PlaySessionModel = model<PlaySessionDocument>('PlaySession', playSessionSchema);
