import type { UserRole } from '../constants/roles';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  name: string;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      user?: AuthenticatedUser;
    }
  }
}

export {};
