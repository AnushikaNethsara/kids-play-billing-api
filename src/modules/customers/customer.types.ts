export interface CustomerPublic {
  id: string;
  parentName: string;
  phoneNumber: string;
  email: string;
  notes: string;
  visitCount: number;
  totalSpent: number;
  lastVisitAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCustomerInput {
  parentName?: string;
  phoneNumber?: string;
  email?: string;
  notes?: string;
}

export interface UpdateCustomerInput {
  parentName?: string;
  phoneNumber?: string;
  email?: string;
  notes?: string;
}

export interface ListCustomersQuery {
  page: number;
  limit: number;
  search?: string;
}

export interface CustomerChild {
  childName: string;
  lastCheckInAt: Date;
}

/** One child of a family, across every ticket and bill they appeared on. */
export interface CustomerProfileChild {
  name: string;
  /** Distinct business days this child played. */
  visits: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** Billed minutes of play, summed. A child still playing contributes nothing yet. */
  totalPlayMinutes: number;
  /** The package this child played on most often. */
  favouritePackage: string | null;
}

export interface CustomerFrequency {
  totalVisits: number;
  visitsThisWeek: number;
  visitsThisMonth: number;
  visitsLast90Days: number;
  /** Mean gap between consecutive visits, in days. Null below two visits. */
  averageDaysBetweenVisits: number | null;
  firstVisitAt: Date | null;
  lastVisitAt: Date | null;
}

export interface CustomerProfile {
  customerId: string;
  children: CustomerProfileChild[];
  frequency: CustomerFrequency;
  /** One entry per visit day in the last 365 days, oldest first. */
  heatmap: { day: string; children: number }[];
}

/** One visit day of a family, as the visit timeline shows it. */
export interface CustomerVisitRow {
  /** The business day, `YYYY-MM-DD`. */
  date: string;
  timeIn: Date | null;
  timeOut: Date | null;
  children: string[];
  groups: string[];
  packages: string[];
  /** Socks and the like on that day's bills. */
  extrasTotal: number;
  /** What the day's bills came to. */
  amount: number;
  refunded: boolean;
  bills: { id: string; billNumber: string | null }[];
}

export interface ListCustomerVisitsQuery {
  page: number;
  limit: number;
}
