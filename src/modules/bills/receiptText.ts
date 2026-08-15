const PAPER_WIDTH_CHARS: Record<string, number> = {
  '58MM': 32,
  '80MM': 48,
};

export function getPaperWidthChars(paperWidth: string): number {
  return PAPER_WIDTH_CHARS[paperWidth] ?? PAPER_WIDTH_CHARS['58MM'];
}

export function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const totalPadding = width - text.length;
  const left = Math.floor(totalPadding / 2);
  const right = totalPadding - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export function dashLine(width: number): string {
  return '-'.repeat(width);
}

/** Left-aligned label, right-aligned value, e.g. "Subtotal                800.00" */
export function twoColumnLine(label: string, value: string, width: number): string {
  const combinedLength = label.length + value.length;
  if (combinedLength >= width) {
    return `${label} ${value}`.slice(0, width);
  }
  return label + ' '.repeat(width - combinedLength) + value;
}

/** "1h 17m" / "45m" - compact enough for a 32-column receipt. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function wrapText(text: string, width: number): string[] {
  if (text.length <= width) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    lines.push(remaining.slice(0, width));
    remaining = remaining.slice(width);
  }
  if (remaining.length > 0) lines.push(remaining);
  return lines;
}
