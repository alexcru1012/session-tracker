import { User } from '@/models/users/types';

declare global {
  namespace Express {
    interface Request {
      user: User;
    }
  }
}
