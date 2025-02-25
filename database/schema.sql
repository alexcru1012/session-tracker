
--
-- Public Schema rules
--

GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO PUBLIC;

--
-- Users
--

CREATE TABLE IF NOT EXISTS users (
  id serial,
  email varchar(255) NOT NULL,
  password varchar(255),
  name varchar(255),
  avatar text,
  slug citext,
  company varchar(100),
  industry varchar(100),
  contact_email varchar(100),
  contact_phone varchar(100),
  is_admin boolean DEFAULT false,
  is_activated boolean DEFAULT false,
  is_active boolean DEFAULT true,
  activation_token varchar(100),
  activation_token_expires timestamp with time zone,
  reset_password_token varchar(100),
  reset_password_expires timestamp with time zone,
  has_accepted_terms boolean DEFAULT false,
  expo_push_token varchar(100),
  app_version varchar(11),
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  last_login_at timestamp with time zone,
  tz varchar(50),
  currency varchar(3) DEFAULT 'USD',
  subscription_id integer,
  ot_password varchar(100),
  
  PRIMARY KEY (id),
  UNIQUE (email),
  UNIQUE (slug)
);

ALTER TABLE users OWNER TO sessionuser;
REVOKE ALL ON TABLE users FROM PUBLIC;
GRANT ALL ON TABLE users TO sessionuser;

--
-- User Subscriptions
--

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id serial,
  user_id integer NOT NULL,
  tier smallint DEFAULT 1,
  is_active boolean DEFAULT true,
  expires_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id)
);

ALTER TABLE user_subscriptions OWNER TO sessionuser;
REVOKE ALL ON TABLE user_subscriptions FROM PUBLIC;
GRANT ALL ON TABLE user_subscriptions TO sessionuser;

--
-- Clients
--

CREATE TABLE IF NOT EXISTS clients (
  id serial,
  user_id integer NOT NULL,
  name_alias varchar(100) NOT NULL,
  email_alias varchar(100),
  avatar varchar(255),
  gender varchar(100),
  phone_number_1 varchar(42),
  phone_number_2 varchar(42),
  address_1 varchar(100),
  address_2 varchar(100),
  notes text,
  age smallint,
  dob date DEFAULT NULL,
  temp_sessions_left smallint,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE clients OWNER TO sessionuser;
REVOKE ALL ON TABLE clients FROM PUBLIC;
GRANT ALL ON TABLE clients TO sessionuser;

--
-- Sessions
--

CREATE TYPE attendance as ENUM ('PRESENT', 'ABSENT', 'LATE', 'CANCELLED', 'LATE CANCELLED');

CREATE TABLE IF NOT EXISTS sessions (
  id serial,
  client_id integer NOT NULL,
  attendance attendance DEFAULT 'PRESENT',
  notes text,
  price numeric(10, 4) DEFAULT 0.00,
  paid boolean DEFAULT true,
  session_type_id integer,
  used_at timestamp with time zone,
  duration integer,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE sessions OWNER TO sessionuser;
REVOKE ALL ON TABLE sessions FROM PUBLIC;
GRANT ALL ON TABLE sessions TO sessionuser;


--
-- Session Types
--

CREATE TABLE IF NOT EXISTS session_types (
  id serial,
  user_id integer NOT NULL,
  name varchar(100) NOT NULL,
  description varchar(500),
  slug citext,
  color varchar(8),
  price numeric(10, 4) DEFAULT 0.00, -- Most likely to suggest final session price
  duration integer DEFAULT 3600,
  schedule_id integer,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id, name),
  UNIQUE (user_id, slug)
);

ALTER TABLE session_types OWNER TO sessionuser;
REVOKE ALL ON TABLE session_types FROM PUBLIC;
GRANT ALL ON TABLE session_types TO sessionuser;

--
-- Client Todos
--

CREATE TABLE IF NOT EXISTS client_todos (
  id serial,
  client_id integer NOT NULL,
  todo text NOT NULL,
  is_complete boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE client_todos OWNER TO sessionuser;
REVOKE ALL ON TABLE client_todos FROM PUBLIC;
GRANT ALL ON TABLE client_todos TO sessionuser;

--
-- Calendar Events 
--

CREATE TYPE occurrence as ENUM ('SINGLE', 'RECURRING');
CREATE TYPE frequency as ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

CREATE TABLE IF NOT EXISTS calendar_events (
  id serial,
  user_id integer NOT NULL,
  title varchar(100) NOT NULL,
  client_id integer,
  session_type_id integer,
  notes varchar(500),
  color varchar(8),
  is_active boolean DEFAULT true,
  
  starts_at timestamp with time zone,
  local_time time without time zone,
  tz varchar(50),

  occurrence occurrence DEFAULT 'SINGLE',
  duration integer,
  -- RECURRING
  frequency frequency DEFAULT NULL,
  recurring_starts_at timestamp with time zone,
  recurring_ends_at timestamp with time zone,
  interval smallint,
  month_of_year smallint,
  day_of_month smallint,
  day_of_week varchar(30),
  hour_of_day smallint,
  minute_of_hour smallint,

  notification_distance integer DEFAULT 0,
  system_event_id varchar(50),

  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE calendar_events OWNER TO sessionuser;
REVOKE ALL ON TABLE calendar_events FROM PUBLIC;
GRANT ALL ON TABLE calendar_events TO sessionuser;

--
-- Calendar Event Edits
--

CREATE TABLE IF NOT EXISTS calendar_event_edits (
  id serial,
  user_id integer NOT NULL,
  event_id integer NOT NULL,
  event_index smallint NOT NULL,
  
  is_active boolean DEFAULT true,
  starts_at timestamp with time zone,
  local_time time without time zone,
  system_event_id varchar(50),

  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id, event_id, event_index)
);

ALTER TABLE calendar_event_edits OWNER TO sessionuser;
REVOKE ALL ON TABLE calendar_event_edits FROM PUBLIC;
GRANT ALL ON TABLE calendar_event_edits TO sessionuser;

--
-- Chats
--

-- CREATE TABLE IF NOT EXISTS chats (
--   id serial,

--   created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
--   updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

--   PRIMARY KEY (id)
-- );

-- ALTER TABLE chats OWNER TO sessionuser;
-- REVOKE ALL ON TABLE chats FROM PUBLIC;
-- GRANT ALL ON TABLE chats TO sessionuser;

--
-- Chat Users
--

-- CREATE TABLE IF NOT EXISTS chat_users (
--   chat_id integer NOT NULL,
--   user_id integer NOT NULL,
  
--   FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
--   FOREIGN KEY (user_id) REFERENCES users (id), -- ON DELETE CASCADE,
--   CONSTRAINT chat_user_pkey PRIMARY KEY (chat_id, user_id)
-- );

-- ALTER TABLE chat_users OWNER TO sessionuser;
-- REVOKE ALL ON TABLE chat_users FROM PUBLIC;
-- GRANT ALL ON TABLE chat_users TO sessionuser;

--
-- Chat Messages
--

-- CREATE TABLE IF NOT EXISTS chat_messages (
--   id serial,
  
--   chat_id integer NOT NULL,
--   user_id integer NOT NULL,
--   message text NOT NULL,

--   created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
--   -- updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

--   PRIMARY KEY (id),
--   FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE,
--   FOREIGN KEY (user_id) REFERENCES users (id) -- ON DELETE CASCADE,
-- );

-- ALTER TABLE chat_messages OWNER TO sessionuser;
-- REVOKE ALL ON TABLE chat_messages FROM PUBLIC;
-- GRANT ALL ON TABLE chat_messages TO sessionuser;

--
-- Passports
--

CREATE TABLE IF NOT EXISTS apple_passports (
  id serial,
  user_id integer NOT NULL,
  apple_id varchar(255) NOT NULL,
  apple_id_token text NOT NULL,
  authorization_code varchar(255),
  connected boolean,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id, apple_id)
);

ALTER TABLE apple_passports OWNER TO sessionuser;
REVOKE ALL ON TABLE apple_passports FROM PUBLIC;
GRANT ALL ON TABLE apple_passports TO sessionuser;

CREATE TABLE IF NOT EXISTS facebook_passports (
  id serial,
  user_id integer NOT NULL,
  facebook_id varchar(255) NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  connected boolean,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id, facebook_id)
);

ALTER TABLE facebook_passports OWNER TO sessionuser;
REVOKE ALL ON TABLE facebook_passports FROM PUBLIC;
GRANT ALL ON TABLE facebook_passports TO sessionuser;

CREATE TABLE IF NOT EXISTS google_passports (
  id serial,
  user_id integer NOT NULL,
  google_id varchar(255) NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  connected boolean,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (user_id, google_id)
);

ALTER TABLE google_passports OWNER TO sessionuser;
REVOKE ALL ON TABLE google_passports FROM PUBLIC;
GRANT ALL ON TABLE google_passports TO sessionuser;

--
-- Client Options
--

CREATE TABLE IF NOT EXISTS client_options (
  id serial,
  client_id integer NOT NULL,
  option_key text NOT NULL,
  option_value text NOT NULL,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (client_id, option_key)
);

ALTER TABLE client_options OWNER TO sessionuser;
REVOKE ALL ON TABLE client_options FROM PUBLIC;
GRANT ALL ON TABLE client_options TO sessionuser;

--
-- Client Metadata
--

CREATE TABLE IF NOT EXISTS client_meta (
  id serial,
  client_id integer NOT NULL,
  meta_key text NOT NULL,
  meta_value text NOT NULL,
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id),
  UNIQUE (client_id, meta_key)
);

ALTER TABLE client_meta OWNER TO sessionuser;
REVOKE ALL ON TABLE client_meta FROM PUBLIC;
GRANT ALL ON TABLE client_meta TO sessionuser;

--
-- User schedules
--

CREATE TABLE IF NOT EXISTS user_schedules (
  id serial,
  user_id integer NOT NULL,
  name varchar(100) NOT NULL,
  ical text,
  tz varchar(50),
  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE user_schedules OWNER TO sessionuser;
REVOKE ALL ON TABLE user_schedules FROM PUBLIC;
GRANT ALL ON TABLE user_schedules TO sessionuser;


--
-- Scheduled Events
--

CREATE TABLE IF NOT EXISTS scheduled_events (
  id serial,
  user_id integer NOT NULL,
  session_type_id integer NOT NULL,
  
  starts_at timestamp with time zone,
  local_time time without time zone,
  tz varchar(50),

  guest_name varchar(100),
  guest_email varchar(100),
  notes text,
  is_active boolean DEFAULT true,

  created_at timestamp with time zone DEFAULT (now() at time zone 'utc'),
  updated_at timestamp with time zone DEFAULT (now() at time zone 'utc'),

  PRIMARY KEY (id)
);

ALTER TABLE scheduled_events OWNER TO sessionuser;
REVOKE ALL ON TABLE scheduled_events FROM PUBLIC;
GRANT ALL ON TABLE scheduled_events TO sessionuser;

--
-- Constraints go last
--

ALTER TABLE users ADD CONSTRAINT users_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES user_subscriptions (id) ON DELETE SET NULL;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE clients ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT sessions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
ALTER TABLE session_types ADD CONSTRAINT session_types_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE session_types ADD CONSTRAINT session_types_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES user_schedules (id) ON DELETE SET NULL;
ALTER TABLE client_todos ADD CONSTRAINT client_todos_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
ALTER TABLE calendar_event_edits ADD CONSTRAINT calendar_event_edits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE calendar_event_edits ADD CONSTRAINT calendar_event_edits_event_id_fkey FOREIGN KEY (event_id) REFERENCES calendar_events (id) ON DELETE CASCADE;
ALTER TABLE apple_passports ADD CONSTRAINT apple_passports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE facebook_passports ADD CONSTRAINT facebook_passports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE google_passports ADD CONSTRAINT google_passports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE client_options ADD CONSTRAINT client_options_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE;
ALTER TABLE user_schedules ADD CONSTRAINT user_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE scheduled_events ADD CONSTRAINT scheduled_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE scheduled_events ADD CONSTRAINT scheduled_events_session_type_id_fkey FOREIGN KEY (session_type_id) REFERENCES session_types (id) ON DELETE SET NULL;
-- CREATE INDEX idx_scheduled_events_guest_email ON scheduled_events(guest_email);
