import { DateTime } from 'luxon';
import { CounterModel } from './counter.model';
import { DEFAULT_BILL_NUMBER_PREFIX } from '../../config';
import { BillModel } from './bill.model';

/** Older than this, `at` is treated as backdated and candidates are checked for reuse. */
const BACKDATED_THRESHOLD_MS = 60_000;
/** One second can only realistically hold a handful of bills; this just bounds the loop. */
const MAX_BACKDATED_ATTEMPTS = 20;

export const billNumberService = {
  /**
   * Formats a bill number like KPA-20260926-143215 - the date and the time of payment, in
   * the business's own timezone.
   *
   * It used to end in a counter that reset each day, which meant the number printed on a
   * customer's receipt told them how many bills the business had taken that day: two
   * receipts gave the volume between them, and one near closing time gave the day's total.
   * The time reveals only what the customer already knows. The owner still sees the daily
   * count on the dashboard; it simply stopped being public.
   *
   * The atomic counter survives that change, rekeyed from per-day to per-second, because
   * the sequence was never the point - the single $inc/upsert is what makes it impossible
   * for two cashiers completing at the same instant to receive the same number, with no
   * transaction, no retry loop and no dependency on the Mongo topology. A suffix is
   * appended only when a second genuinely is hit twice, which needs two payments completed
   * in the same second on two tills:
   *
   *   first in that second   KPA-20260926-143215
   *   second in that second  KPA-20260926-143215-2
   *
   * Still sorts chronologically as a plain string, so anything ordering or range-comparing
   * bill numbers keeps working.
   */
  async generate(timezone: string, at?: Date): Promise<string> {
    // Luxon's clock rather than Date's, so a frozen `Settings.now` governs both.
    const now = DateTime.now();
    const moment = at ? DateTime.fromJSDate(at) : now;
    const timeKey = moment.setZone(timezone).toFormat('yyyyMMdd-HHmmss');
    const counterId = `${DEFAULT_BILL_NUMBER_PREFIX}-${timeKey}`;

    // A payment dated to an earlier checkout (an admin recovering an abandoned one) can
    // land on a second whose counter row has already expired - rows only live a day - so
    // the counter restarts at 1 and may hand out a number a paid bill already holds. Only
    // then is each candidate checked against the bills themselves; a payment taken now
    // keeps the single atomic $inc above.
    const checkExisting = now.toMillis() - moment.toMillis() > BACKDATED_THRESHOLD_MS;

    for (let attempt = 0; attempt < MAX_BACKDATED_ATTEMPTS; attempt += 1) {
      const counter = await CounterModel.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      ).exec();

      const candidate = counter.seq > 1 ? `${counterId}-${counter.seq}` : counterId;
      if (!checkExisting) return candidate;
      if (!(await BillModel.exists({ billNumber: candidate }))) return candidate;
    }

    throw new Error(`Could not find a free bill number for ${counterId}`);
  },
};
