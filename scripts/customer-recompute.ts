import { connectDatabase, disconnectDatabase } from '../src/database/connection';
import { CustomerModel } from '../src/modules/customers/customer.model';
import { customerService } from '../src/modules/customers/customer.service';
import { logger } from '../src/common/logger/logger';

/**
 * Rebuilds every customer's derived visit figures (`visitCount`, `totalSpent`,
 * `firstVisitAt`, `lastVisitAt`) from their bills. Run it once after deploying a change
 * to those figures - `firstVisitAt` was added for the customer list's segments - and any
 * time they are suspected of drifting.
 *
 *   npm run customers:recompute
 *
 * Writes only the derived figures, so it is safe to run twice. Unlike
 * `customers:cleanup` it never merges or creates customers.
 */
async function run() {
  await connectDatabase();

  let recomputed = 0;
  const cursor = CustomerModel.find({}, { _id: 1 }).lean().cursor();
  for await (const customer of cursor) {
    await customerService.recomputeStats(customer._id.toString());
    recomputed += 1;
    if (recomputed % 500 === 0) logger.info({ recomputed }, 'Recomputing customers...');
  }

  logger.info({ recomputed }, 'Customer visit figures recomputed');
  await disconnectDatabase();
  process.exit(0);
}

run().catch((err) => {
  logger.error({ err }, 'Customer recompute failed');
  process.exit(1);
});
