/** Escapes user-supplied text so it is safe to embed in a MongoDB $regex filter. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
