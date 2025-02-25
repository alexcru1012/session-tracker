export interface ErrnoException extends Error {
  errno?: number;
  code?: string;
  path?: string;
  syscall?: string;
  stack?: string;
}

export type PgFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type Frequency =
  | 'NEVER'
  | 'DAILY'
  | 'WEEKDAYS'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'YEARLY';
export type AlertFrequency =
  | 'NEVER'
  | 'DAILY'
  | 'WEEKLY'
  | 'WEEKDAYS'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'YEARLY';
export type Occurrence = 'SINGLE' | 'RECURRING';
export type CalendarRange = 'DAY' | 'WEEK' | 'MONTH';
export type Attendance =
  | 'PRESENT'
  | 'ABSENT'
  | 'LATE'
  | 'CANCELLED'
  | 'LATE CANCELLED';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | string;

export type ServerResponse<T> = {
  success: boolean;
  message?: string;
  data?: T;
};

export type Pagination = {
  page: number;
  limit: number;
};
