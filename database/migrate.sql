
--
-- Migrations
--

-- DROP TYPE IF EXISTS UserType CASCADE;
-- DROP TYPE IF EXISTS ClientHistoryType CASCADE;

-- DROP TABLE IF EXISTS client_sessions;
-- DROP TABLE IF EXISTS client_history;
-- DROP TABLE IF EXISTS session_history;

-- ALTER TABLE users
--   DROP COLUMN IF EXISTS type CASCADE;

-- ALTER TABLE clients
--   DROP COLUMN IF EXISTS signup_token CASCADE,
--   DROP COLUMN IF EXISTS signup_token_expires CASCADE,
--   DROP COLUMN IF EXISTS last_session_used_at CASCADE,
--   DROP COLUMN IF EXISTS num_sessions CASCADE;

-- ALTER TABLE clients 
--   ADD CONSTRAINT num_sessions CHECK (num_sessions >= 0);

-- ALTER TABLE clients RENAME COLUMN pro_user_id TO user_id;

-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_number_1 varchar(42);
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone_number_2 varchar(42);
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_1 varchar(100);
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS address_2 varchar(100);

-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS notes varchar(500);
-- ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes varchar(500);

-- ALTER TABLE users
--   ALTER reset_password_expires TYPE timestamptz USING reset_password_expires AT TIME ZONE 'UTC',
--   ALTER created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
--   ALTER updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC',
--   ALTER last_login_at TYPE timestamptz USING last_login_at AT TIME ZONE 'UTC';

-- ALTER TABLE clients
--   ALTER created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
--   ALTER updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- ALTER TABLE sessions
--   ALTER used_at TYPE timestamptz USING used_at AT TIME ZONE 'UTC',
--   ALTER created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
--   ALTER updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- ALTER TABLE facebook_passports
--   ALTER created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
--   ALTER updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- ALTER TABLE google_passports
--   ALTER created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
--   ALTER updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

-- ALTER TABLE users ADD COLUMN IF NOT EXISTS has_accepted_terms boolean DEFAULT false;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS business varchar(100);

-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type_id integer;

-- ALTER TABLE session_types ADD COLUMN IF NOT EXISTS price numeric(10, 4) DEFAULT 0.00;

-- ALTER TABLE users RENAME COLUMN business TO company;
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS industry varchar(100);

-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS price numeric(10, 4) DEFAULT 0.00;

-- ALTER TABLE users ALTER updated_at SET DEFAULT (now() at time zone 'utc');
-- ALTER TABLE clients ALTER updated_at SET DEFAULT (now() at time zone 'utc');
-- ALTER TABLE sessions ALTER updated_at SET DEFAULT (now() at time zone 'utc');
-- ALTER TABLE session_types ALTER updated_at SET DEFAULT (now() at time zone 'utc');
-- ALTER TABLE facebook_passports ALTER updated_at SET DEFAULT (now() at time zone 'utc');
-- ALTER TABLE google_passports ALTER updated_at SET DEFAULT (now() at time zone 'utc');

-- ALTER TABLE calendar_events RENAME COLUMN date_start TO starts_at;
-- ALTER TABLE calendar_events RENAME COLUMN date_end TO ends_at;
-- ALTER TABLE calendar_events ALTER title SET NOT NULL;
-- -- ALTER TABLE calendar_events
-- --   ADD CONSTRAINT duplicate_session UNIQUE (user_id, starts_at, title);

-- ALTER TABLE calendar_events ADD COLUMN starts_at timestamp with time zone NOT NULL;
-- ALTER TABLE calendar_events ADD COLUMN ends_at timestamp with time zone;
-- -- ALTER TABLE calendar_events ADD COLUMN occurence occurence DEFAULT 'once';
-- ALTER TABLE calendar_events ADD COLUMN frequency frequency;
-- ALTER TABLE calendar_events ADD COLUMN freq_monthly_dom smallint;
-- ALTER TABLE calendar_events ADD COLUMN freq_week_of_month_wom smallint;
-- ALTER TABLE calendar_events ADD COLUMN freq_week_of_month_dow smallint;
-- ALTER TABLE calendar_events ADD COLUMN freq_weekly_dow smallint;
-- ALTER TABLE calendar_events ADD COLUMN freq_biweekly_dow smallint;
-- ALTER TABLE calendar_events ADD COLUMN is_active boolean;
-- ALTER TABLE calendar_events ALTER is_active SET DEFAULT true;
-- ALTER TABLE calendar_events ALTER frequency SET DEFAULT NULL;

-- ALTER TABLE session_types ADD CONSTRAINT duplicate_session_type UNIQUE (user_id, name);

-- ALTER TABLE calendar_events ADD COLUMN recurring_ends_at timestamp with time zone;
-- ALTER TABLE calendar_events ADD COLUMN recurring_starts_at timestamp with time zone;

-- -- ALTER TYPE frequency ADD VALUE 'yearly' BEFORE 'monthly';

-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS freq_monthly_dom CASCADE;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS freq_week_of_month_wom CASCADE;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS freq_week_of_month_dow CASCADE;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS freq_weekly_dow CASCADE;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS freq_biweekly_dow CASCADE;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS ends_at CASCADE;

-- ALTER TABLE calendar_events ADD COLUMN month_of_year smallint;
-- ALTER TABLE calendar_events ADD COLUMN day_of_month smallint;
-- ALTER TABLE calendar_events ADD COLUMN day_of_week smallint;
-- ALTER TABLE calendar_events ADD COLUMN hour_of_day smallint;
-- ALTER TABLE calendar_events ADD COLUMN minute_of_hour smallint;
-- ALTER TABLE calendar_events ADD COLUMN interval smallint;
-- ALTER TABLE calendar_events ADD COLUMN duration integer;

-- -- DROP TYPE IF EXISTS occurence CASCADE;
-- -- CREATE TYPE occurence as ENUM ('SINGLE', 'RECURRING');

-- -- ALTER TABLE calendar_events ADD COLUMN occurence occurence DEFAULT 'SINGLE';

-- -- DROP TYPE IF EXISTS frequency CASCADE;
-- CREATE TYPE frequency as ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');

-- ALTER TABLE calendar_events ADD COLUMN frequency frequency DEFAULT NULL;

-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS starts_at CASCADE;
-- ALTER TABLE calendar_events ADD COLUMN starts_at timestamp with time zone;
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS occurence CASCADE;
-- -- ALTER TABLE calendar_events ADD COLUMN occurence occurence DEFAULT 'SINGLE';

-- ALTER TABLE calendar_events ALTER day_of_week TYPE varchar(30);
-- -- ALTER TABLE calendar_events 
-- --   ADD CONSTRAINT duplicate_recurring_weekly_session UNIQUE (user_id, title, frequency, day_of_week, hour_of_day, minute_of_hour, recurring_starts_at);
-- -- ALTER TABLE calendar_events 
-- --   ADD CONSTRAINT duplicate_recurring_monthly_session UNIQUE (user_id, title, frequency, day_of_month, hour_of_day, minute_of_hour, recurring_starts_at);
-- -- ALTER TABLE calendar_events 
-- --   ADD CONSTRAINT duplicate_recurring_yearly_session UNIQUE (user_id, title, frequency, month_of_year, day_of_month, hour_of_day, minute_of_hour, recurring_starts_at);

-- -- DROP TYPE IF EXISTS occurence CASCADE;
-- CREATE TYPE occurrence as ENUM ('SINGLE', 'RECURRING');
-- -- ALTER TABLE calendar_events DROP COLUMN IF EXISTS occurence CASCADE;
-- ALTER TABLE calendar_events ADD COLUMN occurrence occurrence DEFAULT 'SINGLE';

-- ALTER TABLE users ADD COLUMN expo_push_token varchar(50);

-- ALTER TABLE calendar_events ADD COLUMN send_notifications boolean DEFAULT false;
-- ALTER TABLE calendar_events ADD COLUMN notification_distance integer DEFAULT 0;

-- ALTER TABLE users ADD COLUMN tz varchar(8);

-- ALTER TABLE calendar_events ADD COLUMN system_event_id varchar(50);

-- -- ALTER TYPE frequency ADD VALUE 'DAILY' BEFORE 'WEEKLY';

-- ALTER TABLE clients ADD COLUMN temp_sessions_left smallint;

-- ALTER TABLE calendar_event_edits ADD COLUMN system_event_id varchar(50);

-- ALTER TABLE users ADD COLUMN app_version varchar(11);

-- ALTER TABLE clients ADD COLUMN age smallint;

-- ALTER TABLE calendar_events DROP CONSTRAINT calendar_events_user_id_starts_at_title_key;
-- ALTER TABLE calendar_events DROP CONSTRAINT duplicate_recurring_weekly_session;
-- ALTER TABLE calendar_events DROP CONSTRAINT duplicate_recurring_monthly_session;
-- ALTER TABLE calendar_events DROP CONSTRAINT duplicate_recurring_yearly_session;

-- ALTER TABLE users ADD COLUMN is_activated boolean DEFAULT false;
-- ALTER TABLE users ADD COLUMN activation_token varchar(100);
-- ALTER TABLE users ADD COLUMN activation_token_expires timestamp with time zone;

-- ALTER TABLE users ALTER tz TYPE varchar(50);
-- ALTER TABLE users ADD COLUMN currency varchar(3) DEFAULT 'USD';

-- CREATE TYPE attendance as ENUM ('PRESENT', 'ABSENT', 'LATE', 'CANCELLED', 'LATE CANCELLED');

-- ALTER TABLE sessions ADD COLUMN attendance attendance default 'PRESENT';

-- ALTER TABLE calendar_events ADD COLUMN color varchar(8);
-- ALTER TABLE calendar_event_edits ADD COLUMN color varchar(8);
-- ALTER TABLE calendar_event_edits ADD COLUMN notes varchar(500);

-- ALTER TABLE users ADD COLUMN contact_email varchar(100);
-- ALTER TABLE users ADD COLUMN contact_phone varchar(100);

-- ALTER TABLE sessions ADD COLUMN paid boolean DEFAULT true;

-- ALTER TABLE google_passports ALTER google_id TYPE varchar(255);

-- ALTER TABLE calendar_events DROP CONSTRAINT duplicate_session;

-- ALTER TABLE users ALTER expo_push_token TYPE varchar(100);

-- ALTER TABLE clients ADD COLUMN is_active boolean default true;

-- ALTER TABLE clients DROP CONSTRAINT clients_user_id_fkey, ADD CONSTRAINT clients_user_id_fkey FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

-- ALTER TABLE calendar_events DROP COLUMN IF EXISTS ends_at CASCADE;

-- ALTER TABLE users ALTER email TYPE varchar(255);
-- ALTER TABLE users ALTER password TYPE varchar(255);
-- ALTER TABLE users ALTER name TYPE varchar(255);
-- ALTER TABLE users ALTER avatar TYPE varchar(255);

-- ALTER TABLE apple_passports RENAME column apple_id TO apple_id_token;
-- ALTER INDEX apple_passports_apple_id_key RENAME TO apple_passports_apple_id_token_key;
-- ALTER TABLE apple_passports ADD COLUMN apple_id varchar(255);
-- ALTER TABLE apple_passports ADD CONSTRAINT apple_passports_apple_id_key UNIQUE (apple_id);

-- ALTER TABLE calendar_events ADD COLUMN local_time time without time zone;
-- ALTER TABLE calendar_events ADD COLUMN tz varchar(50);
-- ALTER TABLE clients DROP CONSTRAINT clients_user_id_name_alias_key;
-- ALTER TABLE clients DROP CONSTRAINT clients_user_id_email_alias_key;

-- ALTER TABLE clients ADD COLUMN dob date DEFAULT NULL;

-- ALTER TABLE sessions DROP COLUMN IF EXISTS client_was_present CASCADE;

-- ALTER TABLE calendar_event_edits DROP COLUMN IF EXISTS color CASCADE;
-- ALTER TABLE calendar_event_edits DROP COLUMN IF EXISTS notes CASCADE;
-- ALTER TABLE calendar_event_edits ADD COLUMN starts_at timestamp with time zone;
-- ALTER TABLE calendar_event_edits ADD COLUMN local_time time without time zone;

-- ALTER TABLE clients ADD COLUMN avatar varchar(255);
-- ALTER TABLE clients ADD COLUMN gender varchar(100);

-- ALTER TABLE clients ALTER notes TYPE text;
-- ALTER TABLE sessions ALTER notes TYPE text;

-- ALTER TABLE google_passports ALTER access_token TYPE text;
-- ALTER TABLE google_passports ALTER refresh_token TYPE text;
-- ALTER TABLE facebook_passports ALTER facebook_id TYPE varchar(255);
-- ALTER TABLE facebook_passports ALTER access_token TYPE text;
-- ALTER TABLE facebook_passports ALTER refresh_token TYPE text;

-- ALTER TABLE users ALTER avatar TYPE text;

-- ALTER TABLE sessions ADD COLUMN duration integer;

-- ALTER TABLE users ADD COLUMN subscription_id integer DEFAULT NULL;

-- ALTER TABLE users ADD CONSTRAINT user_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES user_subscriptions (id)

-- ALTER TABLE calendar_events DROP COLUMN IF EXISTS send_notifications CASCADE;
-- ALTER TABLE user_subscriptions RENAME COLUMN active TO is_active;
-- ALTER TABLE users ADD COLUMN is_active boolean DEFAULT true;
-- ALTER TABLE users ADD COLUMN ot_password varchar(20);
-- ALTER TABLE users ALTER ot_password TYPE varchar(100);

-- ALTER TABLE session_types ADD COLUMN schedule_id integer;
-- ALTER TABLE session_types ADD COLUMN slug varchar(100);
-- ALTER TABLE session_types ADD CONSTRAINT session_types_user_id_slug_key UNIQUE (user_id, slug);
-- ALTER TABLE users ADD COLUMN slug varchar(100);
-- ALTER TABLE users ADD CONSTRAINT users_slug_key UNIQUE (slug);
-- ALTER TABLE facebook_passports DROP CONSTRAINT facebook_passports_facebook_id_key;
-- ALTER TABLE facebook_passports DROP CONSTRAINT facebook_passports_user_id_key;
-- ALTER TABLE facebook_passports ADD CONSTRAINT facebook_passports_user_id_facebook_id_key UNIQUE (user_id, facebook_id);
-- ALTER TABLE google_passports DROP CONSTRAINT google_passports_google_id_key;
-- ALTER TABLE google_passports DROP CONSTRAINT google_passports_user_id_key;
-- ALTER TABLE google_passports ADD CONSTRAINT google_passports_user_id_google_id_key UNIQUE (user_id, google_id);
-- ALTER TABLE apple_passports DROP CONSTRAINT apple_passports_apple_id_key;
-- ALTER TABLE apple_passports ADD CONSTRAINT apple_passports_user_id_apple_id_key UNIQUE (user_id, apple_id);

-- ALTER TABLE user_schedules ALTER name SET NOT NULL;
-- ALTER TABLE session_types DROP CONSTRAINT session_types_schedule_id_fkey;
-- ALTER TABLE session_types ADD CONSTRAINT session_types_schedule_id_fkey FOREIGN KEY (schedule_id) REFERENCES user_schedules (id) ON DELETE SET NULL;
-- ALTER TABLE users DROP CONSTRAINT users_subscription_id_fkey;
-- ALTER TABLE users ADD CONSTRAINT users_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES user_subscriptions (id) ON DELETE SET NULL;

ALTER TABLE users ALTER slug TYPE citext;
ALTER TABLE session_types ALTER slug TYPE citext;
ALTER TABLE session_types ADD COLUMN duration integer DEFAULT 3600;
ALTER TABLE scheduled_events ADD COLUMN is_active boolean DEFAULT true;
ALTER TABLE scheduled_events ALTER session_type_id SET NOT NULL;
