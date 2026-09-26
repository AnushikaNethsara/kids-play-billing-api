import { DateTime } from 'luxon';
import { CounterModel } from './counter.model';
import { DEFAULT_BILL_NUMBER_PREFIX } from '../../config';

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
  async generate(timezone: string): Promise<string> {
    const timeKey = DateTime.now().setZone(timezone).toFormat('yyyyMMdd-HHmmss');
    const counterId = `${DEFAULT_BILL_NUMBER_PREFIX}-${timeKey}`;

    const counter = await CounterModel.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    ).exec();

    return counter.seq > 1 ? `${counterId}-${counter.seq}` : counterId;
  },
};
