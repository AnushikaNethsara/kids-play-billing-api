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
import { NotFoundError } from '../../common/errors';
import { buildPaginationMeta } from '../../common/utils/pagination';

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

    if (input.parentName !== undefined) customer.parentName = input.parentName;
    if (input.phoneNumber !== undefined) customer.phoneNumber = input.phoneNumber;
    if (input.email !== undefined) customer.email = input.email;
    if (input.notes !== undefined) customer.notes = input.notes;
    await customer.save();

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
   * Called when a bill referencing this customer is completed - not exposed as a
   * standalone endpoint. Looks up-or-creates the customer by phone number so repeat
   * visits accumulate onto the same record.
   */
  async recordVisit(
    customerRef: { id?: string; parentName?: string; phoneNumber?: string },
    amountSpent: number,
    visitDate: Date,
  ): Promise<string | null> {
    let customer: CustomerHydrated | null = null;

    if (customerRef.id) {
      customer = await customerRepository.findById(customerRef.id);
    } else if (customerRef.phoneNumber) {
      customer = await customerRepository.findByPhoneNumber(customerRef.phoneNumber);
      if (!customer) {
        customer = await customerRepository.create({
          parentName: customerRef.parentName ?? '',
          phoneNumber: customerRef.phoneNumber,
          email: '',
          notes: '',
        });
      }
    }

    if (!customer) return null;

    customer.visitCount += 1;
    customer.totalSpent += amountSpent;
    customer.lastVisitAt = visitDate;
    if (customerRef.parentName && !customer.parentName) customer.parentName = customerRef.parentName;
    await customer.save();

    return customer.id;
  },

  /**
   * Corrects a visit that recordVisit already counted - currently only used when a bill
   * is marked as, or unmarked from, a test bill. A test bill must not leave the parent
   * with a visit and a lifetime spend the business never actually took.
   *
   * Resolves the customer exactly as recordVisit did, but never creates one: there is
   * nothing to correct on a record that does not exist. `lastVisitAt` is deliberately
   * left alone - the previous visit date is not recoverable from here, and a slightly
   * late "last seen" is a far smaller lie than a wrong lifetime spend.
   */
  async adjustVisitStats(
    customerRef: { id?: string; phoneNumber?: string },
    delta: { visitCount: number; totalSpent: number },
  ): Promise<void> {
    let customer: CustomerHydrated | null = null;

    if (customerRef.id) {
      customer = await customerRepository.findById(customerRef.id);
    } else if (customerRef.phoneNumber) {
      customer = await customerRepository.findByPhoneNumber(customerRef.phoneNumber);
    }

    if (!customer) return;

    // Clamped at zero: records get edited and merged between the visit and the
    // correction, and a negative visit count or lifetime spend is worse than a low one.
    customer.visitCount = Math.max(0, customer.visitCount + delta.visitCount);
    customer.totalSpent = Math.max(0, customer.totalSpent + delta.totalSpent);
    await customer.save();
  },
};
