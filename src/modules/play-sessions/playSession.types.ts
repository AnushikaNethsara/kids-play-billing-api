import type { PlaySessionStatus } from '../../common/constants/sessionStatus';

export interface CheckInInput {
  ticketCode: string;
  childName: string;
  playPackageId: string;
  /** ISO timestamp from the device. Defaults to server time when omitted (online check-in). */
  checkInAt?: string;
  customer?: {
    customerId?: string;
    parentName?: string;
    phoneNumber?: string;
  };
}

export interface VoidSessionInput {
  reason: string;
}

/**
 * `created` is false when the ticket code was already known - a retried offline sync
 * replaying a check-in it had already completed. The caller uses it to answer 200
 * rather than 201, so a replay is distinguishable from a fresh check-in.
 */
export interface CheckInResult {
  session: PlaySessionPublic;
  created: boolean;
}

export interface PlaySessionPublic {
  id: string;
  ticketCode: string;
  status: PlaySessionStatus;
  childName: string;
  playPackageId: string;
  packageName: string;
  rateDurationMinutes: number;
  unitPrice: number;
  customerId: string | null;
  parentName: string;
  phoneNumber: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  billedMinutes: number | null;
  billId: string | null;
  checkInCashierId: string;
  checkInCashierName: string;
  checkOutCashierId: string | null;
  checkOutCashierName: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A non-binding price for a session as of a given moment, so the cashier's screen can
 * show a live running total. The authoritative amount is always recomputed inside
 * `POST /bills/from-sessions`.
 */
export interface SessionQuote {
  asOf: Date;
  elapsedMinutes: number;
  billedMinutes: number;
  minimumApplied: boolean;
  lineTotal: number;
  /** True once the session has run past `BusinessSettings.maximumSessionHours`. */
  exceedsMaximumSession: boolean;
}

export interface PlaySessionWithQuote {
  session: PlaySessionPublic;
  /** Null for sessions that are no longer active - there is nothing left to quote. */
  quote: SessionQuote | null;
}

export interface ListPlaySessionsQuery {
  page: number;
  limit: number;
  status?: PlaySessionStatus;
  phoneNumber?: string;
  childName?: string;
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest';
}
