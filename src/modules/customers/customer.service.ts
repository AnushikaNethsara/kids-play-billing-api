import { customerRepository } from './customer.repository';
import { playSessionRepository } from '../play-sessions/playSession.repository';
import type { CustomerHydrated } from './customer.model';
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersQuery,
  CustomerPublic,
  CustomerChild,
} from './customer.types';
import { DuplicateResourceError, NotFoundError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';
import { BillModel } from '../bills/bill.model';
import { settingsService } from '../settings/settings.service';
import {
  SPEND_BILL_MATCH,
  VISIT_BILL_MATCH,
  customerBillsMatch,
  visitDayExpr,
} from './customerVisits';

function toPublic(customer: CustomerHydrated): CustomerPublic {
  return {
    id: customer.id,
    parentName: customer.parentName,
    phoneNumber: customer.phoneNumber,
    email: customer.email,
    notes: customer.notes,
    visitCount: customer.visitCount,
    totalSpent: customer.totalSpent,
    lastVisitAt: customer.lastVisitAt,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export const customerService = {
  async create(input: CreateCustomerInput): Promise<CustomerPublic> {
    const customer = await customerRepository.create({
      parentName: input.parentName ?? '',
      phoneNumber: input.phoneNumber ?? '',
      email: input.email ?? '',
      notes: input.notes ?? '',
    });
    return toPublic(customer);
  },

  async list(query: ListCustomersQuery) {
    const { customers, total } = await customerRepository.list(
      { search: query.search },
      { page: query.page, limit: query.limit },
    );

    return {
      customers: customers.map(toPublic),
      meta: buildPaginationMeta({ page: query.page, limit: query.limit }, total),
    };
  },

  async getById(id: string): Promise<CustomerPublic> {
    const customer = await customerRepository.findById(id);
    if (!customer) throw new NotFoundError('Customer not found');
    return toPublic(customer);
  },

  async update(id: string, input: UpdateCustomerInput): Promise<CustomerPublic> {
    const customer = await customerRepository.findById(id);
    if (!customer) throw new NotFoundError('Customer not found');

    const phoneChanged = input.phoneNumber !== undefined && input.phoneNumber !== customer.phoneNumber;
    if (input.parentName !== undefined) customer.parentName = input.parentName;
    if (input.phoneNumber !== undefined) customer.phoneNumber = input.phoneNumber;
    if (input.email !== undefined) customer.email = input.email;
    if (input.notes !== undefined) customer.notes = input.notes;
    try {
      await customer.save();
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new DuplicateResourceError('Another customer already has this phone number');
      }
      throw err;
    }

    // The number is the family's identity: a new one brings a different set of bills.
    if (phoneChanged) {
      await this.recomputeStats(customer.id);
      return toPublic((await customerRepository.findById(customer.id)) ?? customer);
    }

    return toPublic(customer);
  },

  async searchByPhoneNumber(phoneNumber: string): Promise<CustomerPublic[]> {
    const customers = await customerRepository.searchByPhoneNumber(phoneNumber);
    return customers.map(toPublic);
  },

  /** Children previously checked in under this phone number, most recent first. */
  async getChildrenByPhoneNumber(phoneNumber: string): Promise<CustomerChild[]> {
    return playSessionRepository.findRecentChildrenByPhoneNumber(phoneNumber);
  },

  /**
   * The customer a paid bill belongs to, created on first sight of its phone number so a
   * family's visits accumulate on one record. Not an endpoint: called when a bill is
   * paid. Returns null for an anonymous walk-in - no id and no number.
   *
   * An upsert on the normalised number, so two tills paying the same family's first two
   * bills at once cannot create two customers: the unique index turns the loser's insert
   * into E11000, and it reads back the winner's record instead.
   */
  async ensureCustomer(customerRef: {
    id?: string;
    parentName?: string;
    phoneNumber?: string;
  }): Promise<string | null> {
    if (customerRef.id) {
      const existing = await customerRepository.findById(customerRef.id);
      if (existing) return existing.id;
    }
    if (!customerRef.phoneNumber) return null;

    let customer: CustomerHydrated | null;
    try {
      customer = await customerRepository.upsertByPhoneNumber(customerRef.phoneNumber);
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      customer = await customerRepository.findByPhoneNumber(customerRef.phoneNumber);
    }
    if (!customer) return null;

    if (customerRef.parentName && !customer.parentName) {
      customer.parentName = customerRef.parentName;
      await customer.save();
    }
    return customer.id;
  },

  /**
   * Rebuilds a customer's visit count, lifetime spend and last visit from their bills.
   *
   * These used to be counters bumped on every payment, and they drifted: a pair of socks
   * counted as a visit, two bills on one day counted as two, and cancelling a paid bill
   * never took its visit back off. Derived instead - always from the one visit definition
   * in `customerVisits.ts` - so any change to a bill can simply recompute, and running it
   * twice changes nothing.
   */
  async recomputeStats(customerId: string): Promise<void> {
    const customer = await customerRepository.findById(customerId);
    if (!customer) return;

    const { timezone } = await settingsService.getRaw();
    const identity = customerBillsMatch(customer);

    const [visits] = await BillModel.aggregate<{ visitCount: number; lastVisitAt: Date | null }>([
      { $match: { $and: [identity, VISIT_BILL_MATCH] } },
      { $group: { _id: visitDayExpr(timezone), lastPaidAt: { $max: '$paidAt' } } },
      { $group: { _id: null, visitCount: { $sum: 1 }, lastVisitAt: { $max: '$lastPaidAt' } } },
    ]);
    const [spend] = await BillModel.aggregate<{ totalSpent: number }>([
      { $match: { $and: [identity, SPEND_BILL_MATCH] } },
      { $group: { _id: null, totalSpent: { $sum: '$grandTotal' } } },
    ]);

    await customerRepository.setStats(customer.id, {
      visitCount: visits?.visitCount ?? 0,
      lastVisitAt: visits?.lastVisitAt ?? null,
      totalSpent: spend?.totalSpent ?? 0,
    });
  },

  /**
   * Recomputes the customer a bill belongs to, after the bill changed in a way that moves
   * a visit or a spend - cancelled, refunded, or (un)marked as a test. Never creates a
   * customer: a bill that never reached one has nothing to correct.
   */
  async recomputeStatsForBill(bill: {
    customerId?: { toString(): string } | null;
    phoneNumber?: string | null;
  }): Promise<void> {
    let customerId = bill.customerId ? bill.customerId.toString() : null;
    if (!customerId && bill.phoneNumber) {
      customerId = (await customerRepository.findByPhoneNumber(bill.phoneNumber))?.id ?? null;
    }
    if (customerId) await this.recomputeStats(customerId);
  },
};
