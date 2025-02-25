// Keep this up to date to verify user has the latest update
export const APP_VERSION = '1.15.0';

export const Options = {
  jwtExpiresIn: 300 * 24 * 60 * 60, // 300 days
  jwtExpiresInNonAuthed: 14 * 24 * 60 * 60, // 14 days
  defaultCacheTimeS: 240, // 4 min
  defaultSessionDurationS: 3600,
  activationTokenExpiresInD: 10,
  resetPasswordExpiresInD: 3,
};

export const Strings = {
  appName: 'Session Tracker',
  appUrl: process.env.HOME_BASE || 'https://mysessiontracker.com/',
  defaultError: 'Oops! Something went wrong.',
  defaultSuccess: 'Success',
};

export const S3Buckets = {
  avatars: 'com.listenfirstlabs.mysessiontracker.avatars',
  clientAvatars: 'com.listenfirstlabs.mysessiontracker.client-avatars',
};

export const TierLimits = {
  // Banned account
  0: 0,
  // Free user
  1: 3,
  // Unlimited user
  2: 999,
  // Does not exist
  3: 999,
};

export const HomeUrls = {
  index: `${process.env.HOME_BASE}`,
  activate: `${process.env.HOME_BASE}/activate`,
  purchase: `${process.env.HOME_BASE}/purchase`,
};

export const WebAppUrls = {
  index: `${process.env.WEB_BASE}`,
  settings: `${process.env.WEB_BASE}/settings`,
  profileSettings: `${process.env.WEB_BASE}/settings/profile`,
  availabilitySettings: `${process.env.WEB_BASE}/settings/availability`,
  loginSettings: `${process.env.WEB_BASE}/settings/login`,
  billing: `${process.env.WEB_BASE}/billing`,
  upgrade: `${process.env.WEB_BASE}/upgrade`,
};

export const CacheKeys = {
  meKey: userId => `st__me__${userId}`,
  passportJWTKey: jwtEmail => `st__jwt__${jwtEmail}`,
  getPassports: userId => `st__userPassports__${userId}`,

  clientsKey: userId => `st__user__${userId}__myClients`,
  clientsSimpleKey: userId => `st__user__${userId}__clientsSimple`,
  clientKey: (userId, clientId) => `st__user__${userId}__client__${clientId}`,
  clientSimpleKey: (userId, clientId) =>
    `st__user__${userId}__clientSimple__${clientId}`,
  clientSimpleKeyDANGER: clientId => `st__user__???__clientSimple__${clientId}`,

  archivedClientsKey: userId => `st__user__${userId}__archivedClients`,

  // myClientEventsKey: (userId, clientId) =>
  //   `st__user__${userId}__client__${clientId}__events`,

  sessionTypesKey: userId => `st__user__${userId}__sessionTypes`,
  sessionTypesPublicKey: userId => `st__user__${userId}__sessionTypesPublic`,
  sessionTypeKey: (userId, sessionTypeId) =>
    `st__user__${userId}__sessionTypes__${sessionTypeId}`,
  sessionTypePublicKey: (userId, sessionTypeSlug) =>
    `st__user__${userId}__sessionTypePublic__${sessionTypeSlug}`,

  usedSessionCountKey: clientId => `st__client__${clientId}__usedSessionCount`,
  availableSessionsKey: clientId =>
    `st__client__${clientId}__availableSessions`,
  usedSessionsKey: clientId => `st__client__${clientId}__usedSessions`,
  sessionsKey: clientId => `st__client__${clientId}__sessions`,
  allSessionNotesKey: clientId => `st__client__${clientId}__allSessionNotes`,
  clientTodoKey: (clientId, todoId) =>
    `st__client__${clientId}__${todoId}__todo`,
  clientTodosKey: clientId => `st__client__${clientId}__todos`,
  clientOptionsKey: clientId => `st__client__${clientId}__options`,
  clientOptionKey: (clientId, optionId) =>
    `st__client__${clientId}__${optionId}`,
  clientMetasKey: clientId => `st__client__${clientId}__metas`,
  clientMetaKey: (clientId, metaId) =>
    `st__client__${clientId}__meta__${metaId}`,
  sessionKey: sessionId => `st__session__${sessionId}`,

  // Maybe subgroup of calendar?
  cancelledEvent: {
    notifiyClient: (userId, clientId, eventId) =>
      `st__cancelledEvent__notifyClient__${userId}__${eventId}__${clientId}`,
  },
  // TODO refactor keys into smaller objects
  calendar: {},
  calendarEventsKey: (userId, start = '0', end = '0') =>
    `st__cal__${userId}__${start}__${end}`,
  pgCalendarEventsKey: (userId, start = '0', end = '0') =>
    `st__pgCal__${userId}__${start}__${end}`,
  calendarEventKey: eventId => `st__cal__${eventId}`,
  pgCalendarEventKey: eventId => `st__pgCal__${eventId}`,
  calendarEventsForClientKey: (userId, clientId, index = 0) =>
    `st__cal__${userId}__client__${clientId}__events__${index}`,
  pgCalendarEventsForClientKey: (userId, clientId, index = '0') =>
    `st__pgCal__${userId}__client__${clientId}__events__${index}`,
  calendarEventForClientScheduled: eventId =>
    `st__cal__eventScheduled__${eventId}`,
  calendarAllActiveUserEvents: () => 'st__cal__allActiveUserEvents',

  calendarEventEditsForUserKey: userId => `st__calEditsForUser__${userId}`,
  calendarEventEditsKey: (userId, eventId) =>
    `st__calEdits__${userId}__${eventId}`,
  calendarEventEditKey: (userId, eventId, editId) =>
    `st__calEdits__${userId}__${eventId}__${editId}`,
  calendarAllActiveUserEventEdits: () => 'st__calEdits__allActiveUserEdits',
  calendarProcessedEventsKey: userId => `st__processedEvents__${userId}`,

  // TODO refactor keys into smaller objects
  cron: {},
  cronEventIdStartingSoon: eventId => `st__cron__eventIdStarting__${eventId}`,
  cronEventIdEnded: eventId => `st__cron__eventIdEnded__${eventId}`,
  cronEventIdPushSent: eventId => `st__cron__eventIdPushSent__${eventId}`,
  // cronEventIdEmailSent: eventId => `st__cron__eventIdEmailSent__${eventId}`,
  cronEventIdProcessed: (userId, eventId) =>
    `st__cron__clientEventProcessed__${userId}__${eventId}`,
  cronClientEventSessionAdded: (userId, clientId, eventId, sessionId) =>
    `st__cron__eventAdded__${userId}__${clientId}__${eventId}__${sessionId}`,
  cronFailedPushNotificationTickets: () =>
    'st__cron__failedPushNotificationTickets',

  userKey: userId => `st__user__${userId}`,
  userEmailKey: email => `st__user__email__${email}`,
  userSlugKey: slug => `st__user__slug__${slug}`,
  activeUserKey: userId => `st__activeUser__${userId}`, // 60d cache to track active users
  activeUserIdsKey: () => 'st__activeUserIds',
  activeUsersKey: () => 'st__activeUsers',
  activeUsersKeyOLD: () => 'st__activeUsersOLD',

  adminDashboard: () => 'st__admin__dashboard',
  adminEmails: () => 'st__admin__emails',
  adminUserCount: () => 'st__admin__userCount',
  adminRecentUsers: () => 'st__admin__recentUsers',
  adminUser: userId => `st__admin__user__${userId}`,
  adminUserClientCount: userId => `st__admin__user__${userId}__clientCount`,
  adminUserRecentClients: userId => `st__admin__user__${userId}__recentClients`,
  adminTotalClients: () => 'st__admin__totalClients',

  failedPushNotifications: () => 'st__email__failedPushNotifications',

  chat: chatId => `st__chat__${chatId}`,
  chats: userId => `st__chats__${userId}`,
  chatUser: (chatId, userId) => `st__chatUser__${chatId}__${userId}`,
  usersForChat: chatId => `st__usersForChat__${chatId}`,
  messagesForChat: chatId => `st__messagesForChat__${chatId}`,

  // TODO refactor
  // Emails
  emails: {
    health: {
      postgresCheck: () => 'st__cron__postgresHealthCheck',
      postgresCheckSent: () => 'st__cron__postgresHealthCheck--sent',
    },
    toUser: {
      activate: email => `st__email__newUserActivation__${email}`,
    },
    toClient: {
      eventCancellationSent: (userId, eventId, clientId) =>
        `st__cron__cancelSent__${userId}__${eventId}__${clientId}`,
    },
  },
  clientEventConfirmation: (userId, eventId, clientId) =>
    `st__cron__confirmationSent__${userId}__${eventId}__${clientId}`,
  clientEventCancellation: (userId, eventId, clientId) =>
    `st__cron__cancel__${userId}__${eventId}__${clientId}`,
  clientEventReminder: (userId, eventId, clientId) =>
    `st__cron__reminderSent__${userId}__${eventId}__${clientId}`,
  userSupportMessage: userId => `st__supportMessage__${userId}`,
  sessionReceipt: (userId, clientId, sessionId) =>
    `st__email__sessionReceipt__${userId}__${clientId}__${sessionId}`,
  myClientsCsv: userId => `st__email__myClients__${userId}`,
  allUsedSessionsForUser: (userId, start = '0', end = '0') =>
    `st__usedSessionsFor__${userId}__${start}__${end}`,
  allUsedSessionsForUserMonthly: (userId, start = '0', end = '0') =>
    `st__usedSessionsForMonthly__${userId}__${start}__${end}`,

  // Dashboard
  dashboard: {
    usage: userId => `st__dashboard__usage__${userId}`,
    weeklySummary: userId => `st__dashboard__weeklySummary__${userId}`,
    monthlySummary: userId => `st__dashboard__monthlySummary__${userId}`,
    nextEvents: userId => `st__dashboard__nextEvents__${userId}`,
  },

  payment: {
    prices: () => 'st__payment__prices',
    userSubscription: subscriptionId => `st__userSub__${subscriptionId}`,
  },

  schedule: {
    userSchedules: userId => `st__schedules__${userId}`,
    userSchedule: (userId, scheduleId) =>
      `st__schedule__${userId}__${scheduleId}`,
  },

  scheduledEvents: {
    all: userId => `st__scheduledEvents__${userId}`,
    single: (userId, scheduledEventId) =>
      `st__scheduledEvent__${userId}__${scheduledEventId}`,
  },
};

export const OmitProps = {
  me: [
    'password',
    'ot_password',
    'reset_password_token',
    'reset_password_expires',
    'is_admin',
    'activation_token',
    'activation_token_expires',
    'subscription_id',
  ],
  user: [
    'password',
    'ot_password',
    'reset_password_token',
    'reset_password_expires',
    'is_admin',
    'activation_token',
    'activation_token_expires',
    'subscription',
    'subscription_id',
  ],
  userPublic: [
    'email',
    'password',
    'ot_password',
    'reset_password_token',
    'reset_password_expires',
    'is_admin',
    'activation_token',
    'activation_token_expires',
    'subscription',
    'subscription_id',
    'app_version',
    'business',
    'expo_push_token',
    'has_accepted_terms',
    'industry',
    'is_activated',
    'is_active',
    'last_login_at',
    'contact_email',
    'contact_phone',
  ],
  userMeta: [
    // Do not need these on FE
    'stripeSessionId',
    'stripeCustomerId',
    'stripeSubscriptionId',
    'wasSentMissingEmail',
    'hasUnsubscribedFromEmails',
    'clientsWhoHaveUnsubscribed',
    'wasSentUpgradeSuccessEmail',
  ],
  client: ['user_id'],
  clientCSV: [
    'id',
    'user_id',
    'temp_sessions_left',
    'name_alias',
    'email_alias',
    'created_at',
    'updated_at',
  ],
  session: [],
  sessionType: [],
  calendarEvent: [],
  calendarEventEdit: [],
  chatMessage: [],
  passport: ['google_id', 'access_token', 'refresh_token'],
  subscription: ['id', 'user_id', 'created_at', 'updated_at'],
  schedule: [],
};

export const Templates = {
  // Auth
  welcome: 'src/templates/auth/welcome.ejs',
  activate: 'src/templates/auth/activate.ejs',
  forgotPassword: 'src/templates/auth/forgot-password.ejs',
  passwordChanged: 'src/templates/auth/password-changed.ejs',
  oneTimePassword: 'src/templates/auth/one-time-password.ejs',
  // App
  healthCheckPostgres: 'src/templates/misc/health-check-postgres.ejs',
  myClientsCsv: 'src/templates/clients/my-clients-csv.ejs',
  sessionReceipt: 'src/templates/sessions/session-receipt.ejs',
  failedPushNotifications: 'src/templates/misc/failed-push-notifications.ejs',
  supportMessage: 'src/templates/support/support-message.ejs',
  clientEventConfirmation: 'src/templates/calendar/event-confirmation.ejs',
  clientEventReminder: 'src/templates/calendar/event-reminder.ejs',
  clientEventCancelled: 'src/templates/calendar/event-cancelled.ejs',
  missingUser: 'src/templates/users/missing-user.ejs',
  upgradeSuccess: 'src/templates/users/upgrade-success.ejs',
};

export const Occurrences = ['SINGLE', 'RECURRING'];
export const Occurrence = {
  single: 'SINGLE',
  recurring: 'RECURRING',
};

export const Frequencies = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
export const Frequency = {
  daily: 'DAILY',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  yearly: 'YEARLY',
};

export const WeekDays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const WeekDay = {
  0: 'SU',
  1: 'MO',
  2: 'TU',
  3: 'WE',
  4: 'TH',
  5: 'FR',
  6: 'SA',
};

export const Attendances = [
  'PRESENT',
  'ABSENT',
  'LATE',
  'CANCELLED',
  'LATE CANCELLED',
];
export const Attendance = {
  present: 'PRESENT',
  absent: 'ABSENT',
  late: 'LATE',
  cancelled: 'CANCELLED',
  lateCancelled: 'LATE CANCELLED',
};

export const PossibleClientSettings = [
  'sessionConfirmed',
  'dayOfReminder',
  'postSessionSummary',
];

export const ClientSettings = {
  sessionConfirmed: 'sessionConfirmed',
  dayOfReminder: 'dayOfReminder',
  postSessionSummary: 'postSessionSummary',
};

export const ClientSettingDefaults = {
  sessionConfirmed: true,
  dayOfReminder: false,
  postSessionSummary: false,
};
