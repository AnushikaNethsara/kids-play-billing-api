import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { ensureIndexes } from '../src/database/ensureIndexes';
import { runCustomerCleanup } from '../src/modules/customers/customerCleanup';
import { logger } from '../src/common/logger/logger';

/**
 * Normalises phone numbers, merges duplicate customers, links bills and tickets to their
 * family and recomputes every customer's visit figures. See `customerCleanup.ts`.
 *
 *   npm run customers:cleanup              # dry run: report only, writes nothing
 *   npm run customers:cleanup -- --apply   # do it
 *
 * Back the database up before `--apply`: merging customers deletes the duplicates.
 */
async function run() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();

  const report = await runCustomerCleanup({ apply });

  logger.info(
    {
      phonesNormalised: report.phonesNormalised,
      customersMerged: report.merges.reduce((sum, merge) => sum + merge.mergedIds.length, 0),
      customersCreated: report.customersCreated,
      billsLinked: report.billsLinked,
      sessionsLinked: report.sessionsLinked,
      customersRecomputed: report.customersRecomputed,
    },
    apply ? 'Customer cleanup applied' : 'Customer cleanup dry run - nothing was written',
  );
  for (const merge of report.merges) {
    logger.info(merge, apply ? 'Merged customers' : 'Would merge customers');
  }

  if (apply) {
    // With the duplicates gone, the unique customer phone index can now be built.
    await ensureIndexes();
    logger.info('Indexes reconciled');
  } else {
    logger.info('Re-run with `-- --apply` to make these changes');
  }

  await disconnectDatabase();
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'Customer cleanup failed');
  process.exit(1);
});
