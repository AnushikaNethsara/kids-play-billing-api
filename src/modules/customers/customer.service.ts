import { customerRepository } from './customer.repository';
import type { CustomerHydrated } from './customer.model';
import type {
  CreateCustomerInput,
  UpdateCustomerInput,
  ListCustomersQuery,
  CustomerPublic,
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
};
