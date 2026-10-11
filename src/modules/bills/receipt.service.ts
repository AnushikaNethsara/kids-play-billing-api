import { DateTime } from 'luxon';
import type { BillHydrated } from './bill.model';
import type { BusinessSettingsHydrated } from '../settings/settings.model';
import type { ReceiptData, ReceiptItem } from './receipt.types';
import { priceSession, type SessionPriceBreakdown } from './billCalculator';
import { SessionPricingMode } from '../../common/constants/pricingModes';
import { BillItemKind, resolveItemKind } from '../../common/constants/billItemKind';
import { resolveSessionRate } from '../play-sessions/playSession.model';
import { formatMoney } from '../../common/utils/money';
import {
  centerText,
  dashLine,
  formatCompactRate,
  formatDuration,
  getPaperWidthChars,
  twoColumnLine,
  wrapText,
} from './receiptText';

/** The hour from which tiered hours are collapsed into one receipt row. */
const FIRST_COLLAPSED_HOUR = 4;

/**
 * The rows of a tiered line: hours 1 to 3 each on their own, hours from the 4th on in one
 * row (they share a rate), then the extra time. Keeps a long visit to five rows at most.
 */
function buildTierLines(breakdown: SessionPriceBreakdown): { label: string; amount: number }[] {
  const lines: { label: string; amount: number }[] = [];
  const early = breakdown.hourLines.filter((line) => line.hour < FIRST_COLLAPSED_HOUR);
  const late = breakdown.hourLines.filter((line) => line.hour >= FIRST_COLLAPSED_HOUR);

  for (const line of early) {
    lines.push({ label: `Hour ${line.hour} @${formatCompactRate(line.rate)}/h`, amount: line.amount });
  }
  if (late.length === 1) {
    const [line] = late;
    lines.push({ label: `Hour ${line.hour} @${formatCompactRate(line.rate)}/h`, amount: line.amount });
  } else if (late.length > 1) {
    const last = late[late.length - 1];
    lines.push({
      label: `Hrs ${late[0].hour}-${last.hour} @${formatCompactRate(last.rate)}/h`,
      amount: late.reduce((sum, line) => sum + line.amount, 0),
    });
  }
  if (breakdown.overtime) {
    const { overtime } = breakdown;
    const minutes =
      overtime.chargedMinutes === overtime.minutes
        ? formatDuration(overtime.minutes)
        : `${formatDuration(overtime.minutes)}>${formatDuration(overtime.chargedMinutes)}`;
    lines.push({
      label: `Extra ${minutes} @${formatCompactRate(overtime.rate)}/h`,
      amount: overtime.amount,
    });
  }
  return lines;
}

/**
 * A label and its amount on one row when they fit, otherwise the label wrapped and the
 * amount right-aligned beneath it. `twoColumnLine` alone truncates an over-long row, and on
 * a 32-column slip the part it cuts off is the money.
 */
function labelledAmount(label: string, amount: string, width: number): string[] {
  if (label.length + amount.length + 1 <= width) return [twoColumnLine(label, amount, width)];
  return [...wrapText(label, width), twoColumnLine('', amount, width)];
}

export const receiptService = {
  buildReceiptData(bill: BillHydrated, settings: BusinessSettingsHydrated): ReceiptData {
    const paidMoment = bill.paidAt ? DateTime.fromJSDate(bill.paidAt).setZone(settings.timezone) : null;

    return {
      business: {
        name: settings.businessName,
        address: settings.address,
        phoneNumber: settings.phoneNumber,
      },
      bill: {
        billNumber: bill.billNumber,
        date: paidMoment ? paidMoment.toFormat('yyyy-MM-dd') : '',
        time: paidMoment ? paidMoment.toFormat('HH:mm') : '',
        paymentRecordedDate: bill.paymentRecordedAt
          ? DateTime.fromJSDate(bill.paymentRecordedAt).setZone(settings.timezone).toFormat('yyyy-MM-dd')
          : null,
        cashierName: bill.cashierName,
        parentName: bill.parentName,
        items: bill.items.map((item) => {
          const kind = resolveItemKind(item);
          const receiptItem: ReceiptItem = {
            kind,
            childName: item.childName ?? '',
            packageName: item.packageName,
            durationMinutes: item.durationMinutes,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            lineTotal: item.lineTotal,
          };

          if (kind === BillItemKind.GROUP) {
            if (item.visitAt) {
              const visit = DateTime.fromJSDate(item.visitAt).setZone(settings.timezone);
              receiptItem.visitDate = visit.toFormat('dd/MM/yyyy');
              receiptItem.visitTime = visit.toFormat('hh:mm a');
            }
            if (item.visitMinutes) receiptItem.visitDuration = formatDuration(item.visitMinutes);
            return receiptItem;
          }
          if (kind === BillItemKind.PRODUCT) return receiptItem;

          // Only session-billed items carry times; legacy flat-price items have none and
          // fall through to the original layout untouched.
          if (item.billedMinutes !== null && item.billedMinutes !== undefined) {
            receiptItem.billedMinutes = item.billedMinutes;
            receiptItem.billedDuration = formatDuration(item.billedMinutes);
          }
          if (item.checkInAt) {
            receiptItem.checkInTime = DateTime.fromJSDate(item.checkInAt)
              .setZone(settings.timezone)
              .toFormat('hh:mm a');
          }
          if (item.checkOutAt) {
            receiptItem.checkOutTime = DateTime.fromJSDate(item.checkOutAt)
              .setZone(settings.timezone)
              .toFormat('hh:mm a');
          }

          const rate = resolveSessionRate({
            unitPrice: item.unitPrice,
            rateDurationMinutes: item.durationMinutes,
            pricingMode: item.pricingMode,
            graceMinutes: item.graceMinutes,
            tieredPricing: item.tieredPricing,
          });

          // A tiered line is a sum of hours at different rates, plus extra time and a
          // rounding, so it prints one row per part and the total reconciles on paper.
          if (
            rate.pricingMode === SessionPricingMode.TIERED_HOURLY &&
            item.billedMinutes !== null &&
            item.billedMinutes !== undefined
          ) {
            const breakdown = priceSession(rate, item.billedMinutes);
            const hourLabel = `${breakdown.blocksCharged} hr`;
            receiptItem.blockSummary = breakdown.overtime
              ? `${hourLabel} + ${formatDuration(breakdown.overtime.minutes)}`
              : breakdown.graceApplied
                ? `${hourLabel} (${formatDuration(rate.graceMinutes)} free)`
                : hourLabel;
            receiptItem.tierLines = buildTierLines(breakdown);
            if (breakdown.roundingAdjustment !== 0) {
              receiptItem.roundingAdjustment = breakdown.roundingAdjustment;
            }
          }

          // A block line's total is blocks + overage, not a rate scaled to the time
          // played, so the pro-rata "@price/duration" line below would misdescribe it.
          if (
            rate.pricingMode === SessionPricingMode.BLOCK_WITH_GRACE &&
            item.billedMinutes !== null &&
            item.billedMinutes !== undefined
          ) {
            const breakdown = priceSession(rate, item.billedMinutes);

            const blockLabel = `${breakdown.blocksCharged} x ${formatDuration(item.durationMinutes)}`;
            receiptItem.blockSummary = breakdown.overageAmount > 0
              ? `${blockLabel} + ${formatDuration(breakdown.overageMinutes)}`
              : breakdown.graceApplied
                ? `${blockLabel} (${formatDuration(item.graceMinutes ?? 0)} free)`
                : blockLabel;
            receiptItem.overageMinutes = breakdown.overageMinutes;
            receiptItem.overageAmount = breakdown.overageAmount;
          }

          return receiptItem;
        }),
        subtotal: bill.subtotal,
        discount: bill.discount,
        tax: bill.tax,
        grandTotal: bill.grandTotal,
        paidAmount: bill.paidAmount,
        balance: bill.balance,
        paymentMethod: bill.paymentMethod,
      },
      receipt: {
        paperWidth: settings.receiptPaperWidth,
        header: settings.receiptHeader,
        footer: settings.receiptFooter,
        currency: settings.currency,
      },
    };
  },

  buildPlainTextReceipt(data: ReceiptData): string {
    const width = getPaperWidthChars(data.receipt.paperWidth);
    const lines: string[] = [];

    lines.push(centerText(data.business.name.toUpperCase(), width));
    if (data.business.address) lines.push(centerText(data.business.address, width));
    if (data.business.phoneNumber) lines.push(centerText(data.business.phoneNumber, width));
    lines.push(dashLine(width));

    const paidMoment = data.bill.date
      ? DateTime.fromFormat(`${data.bill.date} ${data.bill.time}`, 'yyyy-MM-dd HH:mm')
      : null;

    // Wrapped rather than concatenated raw. The number carries a time now, which takes
    // this line from 23 to 25 of the 32 columns on 58mm paper - still comfortable, but the
    // prefix is a configurable constant, and a longer one would have run off the edge with
    // nothing here to catch it.
    lines.push(...wrapText(`Bill: ${data.bill.billNumber ?? ''}`, width));
    if (paidMoment) lines.push(`Date: ${paidMoment.toFormat('dd/MM/yyyy')}  ${paidMoment.toFormat('hh:mm a')}`);
    if (data.bill.paymentRecordedDate) {
      const recorded = DateTime.fromFormat(data.bill.paymentRecordedDate, 'yyyy-MM-dd');
      lines.push(...wrapText(`Payment recorded ${recorded.toFormat('dd/MM/yyyy')}`, width));
    }
    lines.push(...wrapText(`Cashier: ${data.bill.cashierName}`, width));
    if (data.bill.parentName) lines.push(...wrapText(`Parent: ${data.bill.parentName}`, width));
    lines.push(dashLine(width));

    for (const item of data.bill.items) {
      if (item.kind === BillItemKind.GROUP) {
        // "Group: Sunflower Pre-school", when, then the sum the total is made of, so the
        // teacher holding the receipt can check it: 20 kids x 2h @300/h.
        lines.push(...wrapText(`Group: ${item.packageName}`, width));
        if (item.visitDate) {
          lines.push(...wrapText(`Visit: ${item.visitDate} ${item.visitTime ?? ''}`.trimEnd(), width));
        }
        lines.push(
          ...labelledAmount(
            `${item.quantity} kids x ${item.visitDuration ?? ''} @${formatCompactRate(item.unitPrice)}/h`,
            formatMoney(item.lineTotal),
            width,
          ),
        );
        continue;
      }

      if (item.kind === BillItemKind.PRODUCT) {
        const forChild = item.childName ? ` (${item.childName})` : '';
        lines.push(
          ...labelledAmount(
            `${item.packageName} x ${item.quantity}${forChild}`,
            formatMoney(item.lineTotal),
            width,
          ),
        );
        continue;
      }

      // A family ticket: several children on one line, every row below priced per child.
      const isFamilyTicket = Boolean(item.billedMinutes) && item.quantity > 1;
      lines.push(
        ...wrapText(isFamilyTicket ? `Children (${item.quantity}): ${item.childName}` : `Child: ${item.childName}`, width),
      );

      // Time-billed item: show the parent what they are actually paying for - when the
      // child went in, when they came out, and the rate that was applied.
      if (item.checkInTime && item.checkOutTime) {
        lines.push(...wrapText(`In ${item.checkInTime}  Out ${item.checkOutTime}`, width));
      }
      if (item.billedDuration) {
        lines.push(
          twoColumnLine(
            `Time: ${item.billedDuration}`,
            // A block line shows how the total was made up. The pro-rata form would read
            // as a per-minute rate and invite the parent to multiply it out, which is not
            // how a block line is priced.
            item.blockSummary ?? `@${formatMoney(item.unitPrice)}/${item.durationMinutes}m`,
            width,
          ),
        );
      }
      if (item.overageAmount) {
        lines.push(
          twoColumnLine(
            `  incl. extra ${formatDuration(item.overageMinutes ?? 0)}`,
            formatMoney(item.overageAmount),
            width,
          ),
        );
      }
      for (const tierLine of item.tierLines ?? []) {
        lines.push(twoColumnLine(`  ${tierLine.label}`, formatMoney(tierLine.amount), width));
      }
      if (item.roundingAdjustment) {
        const sign = item.roundingAdjustment > 0 ? '+' : '-';
        lines.push(
          twoColumnLine(
            '  Rounding',
            `${sign}${formatMoney(Math.abs(item.roundingAdjustment))}`,
            width,
          ),
        );
      }

      if (isFamilyTicket) {
        // The rows above explain one child; this is what they add up to, so the paper
        // reconciles before it is multiplied out.
        lines.push(twoColumnLine('  Per child', formatMoney(item.lineTotal / item.quantity), width));
      }
      const label =
        item.billedMinutes && !isFamilyTicket ? item.packageName : `${item.packageName} x ${item.quantity}`;
      lines.push(twoColumnLine(label, formatMoney(item.lineTotal), width));
    }
    lines.push(dashLine(width));

    lines.push(twoColumnLine('Subtotal', formatMoney(data.bill.subtotal), width));
    if (data.bill.discount > 0) {
      lines.push(twoColumnLine('Discount', `-${formatMoney(data.bill.discount)}`, width));
    }
    if (data.bill.tax > 0) {
      lines.push(twoColumnLine('Tax', formatMoney(data.bill.tax), width));
    }
    lines.push(twoColumnLine('TOTAL', formatMoney(data.bill.grandTotal), width));
    lines.push(twoColumnLine('Paid', formatMoney(data.bill.paidAmount), width));
    lines.push(twoColumnLine('Balance', formatMoney(data.bill.balance), width));
    if (data.bill.paymentMethod) lines.push(`Payment: ${data.bill.paymentMethod}`);
    lines.push(dashLine(width));

    lines.push(centerText(data.receipt.footer, width));

    return lines.join('\n');
  },
};
