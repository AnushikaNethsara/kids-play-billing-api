import { Schema, model, type HydratedDocument, Types } from 'mongoose';
import { PlaySessionStatus } from '../../common/constants/sessionStatus';

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
  // already-playing child is charged - same discipline as BillItemSubdocument.
  playPackageId: Types.ObjectId;
  packageName: string;
  /** The rate denominator: `unitPrice` buys this many minutes of play. */
  rateDurationMinutes: number;
  unitPrice: number;

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
  billId: Types.ObjectId | null;

  checkInCashierId: Types.ObjectId;
  checkInCashierName: string;
  checkOutCashierId: Types.ObjectId | null;
  checkOutCashierName: string | null;

  voidedAt: Date | null;
  voidedBy: Types.ObjectId | null;
  voidReason: string | null;

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

    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    parentName: { type: String, default: '' },
    phoneNumber: { type: String, default: '' },

    checkInAt: { type: Date, required: true },
    checkInRecordedAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    billedMinutes: { type: Number, default: null },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', default: null },

    checkInCashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    checkInCashierName: { type: String, required: true },
    checkOutCashierId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    checkOutCashierName: { type: String, default: null },

    voidedAt: { type: Date, default: null },
    voidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    voidReason: { type: String, default: null },
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

export const PlaySessionModel = model<PlaySessionDocument>('PlaySession', playSessionSchema);
