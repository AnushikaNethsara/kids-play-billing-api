import type { Model } from 'mongoose';
import { BillModel } from '../modules/bills/bill.model';
import { logger } from '../common/logger/logger';

/**
 * Indexes whose *options* changed after they had already been created in a live
 * database. Mongoose only ever calls `createIndex`, and MongoDB rejects a create that
 * reuses an existing index name with different options (IndexOptionsConflict, code 85)
 * rather than replacing it. That rejection happens on a background promise nobody
 * awaits, so the process starts cleanly while the collection quietly keeps serving the
 * old definition - the schema says one thing and the database does another.
 *
 * Each entry names an index that must be dropped before the current schema definition
 * can take effect, and the marker that tells the two apart.
 */
const STALE_INDEXES: {
  model: Model<never>;
  name: string;
  /** True when the live index is the outdated one and has to be dropped. */
  isStale: (index: Record<string, unknown>) => boolean;
  reason: string;
}[] = [
  {
    model: BillModel as unknown as Model<never>,
    name: 'billNumber_1',
    // The current definition is a PARTIAL unique index. The one it replaced was
    // `{ unique: true, sparse: true }`, which - because `billNumber` has `default: null`
    // and so is always present - indexed every unpaid draft under the same null key.
    // The second draft created while another was still unpaid therefore failed with
    // `E11000 duplicate key error ... dup key: { billNumber: null }`, surfacing to the
    // app as a 500 on POST /bills and POST /bills/from-sessions.
    isStale: (index) => !index.partialFilterExpression,
    reason: 'unique+sparse billNumber index rejects a second unpaid draft',
  },
];

/**
 * Bring the live indexes in line with the schemas before the server accepts traffic.
 *
 * Only indexes listed in `STALE_INDEXES` are touched, and only when they are still the
 * outdated definition: dropping anything else (as a blanket `syncIndexes()` would) could
 * remove an index an operator added by hand. Safe to run on every boot - once an index
 * has been rebuilt the check finds it current and does nothing.
 */
export async function ensureIndexes(): Promise<void> {
  for (const stale of STALE_INDEXES) {
    const collection = stale.model.collection;

    try {
      const indexes = (await collection.indexes()) as Record<string, unknown>[];
      const live = indexes.find((index) => index.name === stale.name);

      if (!live || !stale.isStale(live)) continue;

      logger.warn(
        { index: stale.name, collection: collection.collectionName, reason: stale.reason },
        'Dropping outdated index so the current schema definition can be rebuilt',
      );
      await collection.dropIndex(stale.name);
    } catch (err) {
      // A missing collection or a concurrent boot that already dropped this index is not
      // an error. Anything else is logged and left: the recreate below is what matters,
      // and a failed drop must not stop the server from coming up.
      logger.warn({ err, index: stale.name }, 'Could not drop outdated index');
    }
  }

  // Recreate whatever the drops removed, from the schema definitions themselves. Awaited
  // rather than left to Mongoose's background autoIndex, so a failure is visible in the
  // startup logs instead of silently leaving the collection without its index.
  for (const model of new Set(STALE_INDEXES.map((stale) => stale.model))) {
    await model.createIndexes();
  }
}
