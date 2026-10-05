import { Types } from 'mongoose';
import { CustomerModel } from './customer.model';
import { customerService } from './customer.service';
import { BillModel } from '../bills/bill.model';
import { PlaySessionModel } from '../play-sessions/playSession.model';
import { auditLogService } from '../audit-logs/auditLog.service';
import { AuditAction, AuditEntityType } from '../../common/constants/auditActions';
import { normalizePhone } from '../../common/utils/phone';
import { subscriptionRepository } from '../subscriptions/subscription.repository';

/**
 * One-off repair of customer data written before phone numbers were normalised, run by
 * `npm run customers:cleanup` (dry run) and `npm run customers:cleanup -- --apply`.
 *
 * 1. Every phone number on customers, bills and tickets is rewritten to `+94XXXXXXXXX`.
 * 2. Customers that turn out to share a number are merged into the oldest one, and every
 *    bill and ticket pointing at a duplicate is repointed.
 * 3. Bills and tickets are linked to their family's customer by phone number - most were
 *    never linked, because the id was only set when a cashier picked a customer by hand.
 *    A number that was paid against but has no customer gets one, as payment would have.
 * 4. Every customer's visit figures are recomputed from the new visit definition.
 *
 * The whole change is worked out in memory first and only then written, so the dry run
 * reports exactly what `--apply` will do. Re-running after an apply finds nothing to do.
 * Volumes are a play area's - thousands of rows - so reading them whole is the simple,
 * honest choice.
 */

export interface CustomerCleanupReport {
  apply: boolean;
  phonesNormalised: { customers: number; bills: number; sessions: number };
  merges: { phoneNumber: string; keptId: string; mergedIds: string[] }[];
  customersCreated: number;
  billsLinked: number;
  sessionsLinked: number;
  customersRecomputed: number;
}

interface LeanCustomer {
  _id: Types.ObjectId;
  phoneNumber?: string;
  parentName?: string;
  email?: string;
  notes?: string;
}

interface LeanLinkable {
  _id: Types.ObjectId;
  phoneNumber?: string;
  customerId?: Types.ObjectId | null;
}

interface LeanBill extends LeanLinkable {
  paidAt?: Date | null;
  parentName?: string;
}

const BATCH_SIZE = 500;

/** Repoints a bill or ticket: its normalised number, and its family's customer. */
function planLinks(
  rows: LeanLinkable[],
  resolveCustomer: (row: LeanLinkable, phoneNumber: string) => string | null,
): { normalised: number; linked: number; ops: { id: Types.ObjectId; set: Record<string, unknown> }[] } {
  let normalised = 0;
  let linked = 0;
  const ops: { id: Types.ObjectId; set: Record<string, unknown> }[] = [];

  for (const row of rows) {
    const set: Record<string, unknown> = {};
    const phoneNumber = normalizePhone(row.phoneNumber);
    if (phoneNumber !== (row.phoneNumber ?? '')) {
      set.phoneNumber = phoneNumber;
      normalised += 1;
    }

    const current = row.customerId ? row.customerId.toString() : null;
    const target = resolveCustomer(row, phoneNumber);
    if (target && target !== current) {
      // Kept as a string here: in a dry run it may be a placeholder for a customer the
      // apply will create. Turned into an ObjectId only when written.
      set.customerId = target;
      if (!current) linked += 1;
    }

    if (Object.keys(set).length > 0) ops.push({ id: row._id, set });
  }

  return { normalised, linked, ops };
}

export async function runCustomerCleanup(options: { apply: boolean }): Promise<CustomerCleanupReport> {
  const { apply } = options;
  const report: CustomerCleanupReport = {
    apply,
    phonesNormalised: { customers: 0, bills: 0, sessions: 0 },
    merges: [],
    customersCreated: 0,
    billsLinked: 0,
    sessionsLinked: 0,
    customersRecomputed: 0,
  };

  // --- Customers: group by the normalised number; the oldest record survives. ---
  const customers = await CustomerModel.find({})
    .sort({ createdAt: 1, _id: 1 })
    .lean<LeanCustomer[]>()
    .exec();

  const keptByPhone = new Map<string, LeanCustomer>();
  /** Every customer id, duplicate or not, to the id it ends up as. */
  const survivorOf = new Map<string, string>();
  const customerUpdates = new Map<string, Record<string, unknown>>();
  const duplicateIds: Types.ObjectId[] = [];

  for (const customer of customers) {
    const id = customer._id.toString();
    const phoneNumber = normalizePhone(customer.phoneNumber);
    const kept = phoneNumber ? keptByPhone.get(phoneNumber) : undefined;

    if (!kept) {
      if (phoneNumber) keptByPhone.set(phoneNumber, customer);
      survivorOf.set(id, id);
      if (phoneNumber !== (customer.phoneNumber ?? '')) {
        customerUpdates.set(id, { phoneNumber });
        report.phonesNormalised.customers += 1;
      }
      continue;
    }

    // A duplicate: fold what it knows into the survivor, then it goes.
    const keptId = kept._id.toString();
    survivorOf.set(id, keptId);
    duplicateIds.push(customer._id);
    const update = customerUpdates.get(keptId) ?? {};
    if (!kept.parentName && customer.parentName) {
      kept.parentName = customer.parentName;
      update.parentName = customer.parentName;
    }
    if (!kept.email && customer.email) {
      kept.email = customer.email;
      update.email = customer.email;
    }
    if (customer.notes && !(kept.notes ?? '').includes(customer.notes)) {
      kept.notes = [kept.notes, customer.notes].filter(Boolean).join('\n');
      update.notes = kept.notes;
    }
    customerUpdates.set(keptId, update);

    const merge = report.merges.find((entry) => entry.keptId === keptId);
    if (merge) merge.mergedIds.push(id);
    else report.merges.push({ phoneNumber, keptId, mergedIds: [id] });
  }

  // --- Bills: link to the family; a number paid against with no customer gets one. ---
  const bills = await BillModel.find({}, { phoneNumber: 1, customerId: 1, paidAt: 1, parentName: 1 })
    .sort({ createdAt: -1 })
    .lean<LeanBill[]>()
    .exec();

  /** Numbers that need a customer created, with the newest parent name seen for them. */
  const toCreate = new Map<string, string>();
  for (const bill of bills) {
    const phoneNumber = normalizePhone(bill.phoneNumber);
    if (!phoneNumber || !bill.paidAt || keptByPhone.has(phoneNumber)) continue;
    if (bill.customerId && survivorOf.has(bill.customerId.toString())) continue;
    if (!toCreate.has(phoneNumber)) toCreate.set(phoneNumber, bill.parentName ?? '');
  }
  report.customersCreated = toCreate.size;

  const createdByPhone = new Map<string, string>();
  if (apply) {
    // Duplicates go first, so the survivor's number can be normalised under the unique
    // index without colliding with a duplicate still holding the same number.
    // Bills and tickets pointing at a duplicate are repointed by the link plan below.
    if (duplicateIds.length > 0) {
      await CustomerModel.deleteMany({ _id: { $in: duplicateIds } }).exec();
    }
    for (const [id, set] of customerUpdates) {
      if (Object.keys(set).length > 0) await CustomerModel.updateOne({ _id: id }, { $set: set }).exec();
    }
    for (const [phoneNumber, parentName] of toCreate) {
      const created = await CustomerModel.create({ phoneNumber, parentName, email: '', notes: '' });
      createdByPhone.set(phoneNumber, created.id);
    }
  }

  const resolveCustomer = (row: LeanLinkable, phoneNumber: string): string | null => {
    if (row.customerId) {
      const survivor = survivorOf.get(row.customerId.toString());
      if (survivor) return survivor;
    }
    if (!phoneNumber) return null;
    const kept = keptByPhone.get(phoneNumber);
    if (kept) return kept._id.toString();
    // In a dry run the customer does not exist yet; any placeholder id marks it linked.
    if (toCreate.has(phoneNumber)) return createdByPhone.get(phoneNumber) ?? `new:${phoneNumber}`;
    return null;
  };

  const billPlan = planLinks(bills, resolveCustomer);
  report.phonesNormalised.bills = billPlan.normalised;
  report.billsLinked = billPlan.linked;

  const sessions = await PlaySessionModel.find({}, { phoneNumber: 1, customerId: 1 })
    .lean<LeanLinkable[]>()
    .exec();
  const sessionPlan = planLinks(sessions, resolveCustomer);
  report.phonesNormalised.sessions = sessionPlan.normalised;
  report.sessionsLinked = sessionPlan.linked;

  if (!apply) {
    report.customersRecomputed = keptByPhone.size + toCreate.size;
    return report;
  }

  const toUpdate = ({ id, set }: { id: Types.ObjectId; set: Record<string, unknown> }) => ({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: typeof set.customerId === 'string' ? { ...set, customerId: new Types.ObjectId(set.customerId) } : set,
      },
    },
  });
  for (let i = 0; i < billPlan.ops.length; i += BATCH_SIZE) {
    await BillModel.bulkWrite(billPlan.ops.slice(i, i + BATCH_SIZE).map(toUpdate));
  }
  for (let i = 0; i < sessionPlan.ops.length; i += BATCH_SIZE) {
    await PlaySessionModel.bulkWrite(sessionPlan.ops.slice(i, i + BATCH_SIZE).map(toUpdate));
  }

  // A duplicate's subscriptions follow it to the survivor, like its bills and tickets.
  for (const merge of report.merges) {
    for (const mergedId of merge.mergedIds) {
      await subscriptionRepository.repointCustomer(mergedId, merge.keptId);
    }
  }

  for (const merge of report.merges) {
    await auditLogService.record({
      userId: null,
      userName: 'customer-cleanup',
      action: AuditAction.CUSTOMERS_MERGED,
      entityType: AuditEntityType.CUSTOMER,
      entityId: merge.keptId,
      metadata: { phoneNumber: merge.phoneNumber, mergedIds: merge.mergedIds },
    });
  }

  const remaining = await CustomerModel.find({}, { _id: 1 }).lean<{ _id: Types.ObjectId }[]>().exec();
  for (const customer of remaining) {
    await customerService.recomputeStats(customer._id.toString());
  }
  report.customersRecomputed = remaining.length;

  return report;
}
