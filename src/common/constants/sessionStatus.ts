export const PlaySessionStatus = {
  /** Child is currently in the play area; the ticket can still be checked out. */
  ACTIVE: 'ACTIVE',
  /** Checked out and attached to a bill. */
  CLOSED: 'CLOSED',
  /** Mistaken check-in, written off without ever producing a bill. */
  VOIDED: 'VOIDED',
} as const;

export type PlaySessionStatus = (typeof PlaySessionStatus)[keyof typeof PlaySessionStatus];
