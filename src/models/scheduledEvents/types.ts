export type ScheduledEvent = {
  id: number;
  user_id: number;
  session_type_id: number;

  starts_at: string;
  local_time: string;
  tz: string;

  guest_name: string;
  guest_email: string;
  notes: string;
  is_active: boolean;

  created_at: string;
  updated_at: string;
};

export type PostScheduledEvent = {
  sessionTypeId: number;

  startsAt: string;
  localTime: string;
  tz: string;

  guestName: string;
  guestEmail: string;
  notes?: string;

  isActive?: boolean;
};
export type PostScheduledEventParams = {
  targetUserId: number;
};
export type GetScheduledEventIdParams = {
  targetUserId: number;
  scheduledEventId: number;
};

export type PostScheduledEventResponse = { scheduledEvent?: ScheduledEvent };
