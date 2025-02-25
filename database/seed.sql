
-- Users

INSERT INTO users (email, password, name)
  VALUES
    ('prosteve@aol.com', '$2a$08$SpOJ/ITDyaS95p1FNRVhVeWbe3ggs6AADOI1xrwhdMn5RyjiG6bEO', 'Charles Hilltop'),
    ('pronico@aol.com', '$2a$08$SpOJ/ITDyaS95p1FNRVhVeWbe3ggs6AADOI1xrwhdMn5RyjiG6bEO', 'Mannus Fredrichson');

-- Sub tiers

INSERT INTO user_subscriptions (user_id, tier, is_active)
  VALUES
    (1, 3, true),
    (2, 3, true);

UPDATE users SET subscription_id = 1 WHERE id = 1;
UPDATE users SET subscription_id = 2 WHERE id = 2;

-- Clients

INSERT INTO clients (user_id, name_alias)
  VALUES
    (1, 'Larry Laffer'),
    (1, 'Average Joe'),
    (2, 'Larry Laffer'),
    (2, 'Average Joe');

-- Sessions

INSERT INTO sessions (client_id, attendance, used_at)
  VALUES
    (1, 'PRESENT', null),
    (1, 'PRESENT', null),
    (1, 'ABSENT', null),
    (1, 'PRESENT', '2018-10-13T05:01:00.000Z'),
    (1, 'PRESENT', '2018-10-13T05:01:00.000Z'),
    (1, 'PRESENT', '2018-10-13T05:02:00.000Z'),
    (2, 'PRESENT', null),
    (2, 'PRESENT', null),
    (2, 'ABSENT', null),
    (2, 'PRESENT', '2018-10-13T05:01:00.000Z'),
    (2, 'PRESENT', '2018-10-13T05:01:00.000Z'),
    (2, 'PRESENT', '2018-10-13T05:02:00.000Z');

-- Session Types

INSERT INTO session_types (user_id, name, description, color, price)
  VALUES
    (2, 'Leg Session', 'Powerful legs', '0099ff', 99.99),
    (2, 'Upper body', 'Everything upper', 'f02973', 59.99 );

-- Calendar Events

INSERT INTO calendar_events (user_id, starts_at, duration, title)
  VALUES
    (2, '2021-01-01T00:00:00.000Z', 5184000, 'New Year''s Day'),
    (2, '2021-02-12T00:00:00.000Z', 5184000, 'Chinese New Year'),
    (2, '2021-02-02T00:00:00.000Z', 5184000, 'Groundhog Day'),
    (2, '2021-02-14T00:00:00.000Z', 5184000, 'Valentine''s Day'),
    (2, '2021-03-17T00:00:00.000Z', 5184000, 'St. Patrick''s Day'),
    (2, '2021-04-22T00:00:00.000Z', 5184000, 'Earth Day'),
    (2, '2021-05-05T00:00:00.000Z', 5184000, 'Cinco de Mayo'),
    (2, '2021-06-19T00:00:00.000Z', 5184000, 'Juneteenth'),
    (2, '2021-07-04T00:00:00.000Z', 5184000, 'Independence Day'),
    (2, '2021-08-09T00:00:00.000Z', 5184000, 'Hijri New Year'),
    (2, '2021-09-07T00:00:00.000Z', 5184000, 'Rosh Hashanah'),
    (2, '2021-09-11T00:00:00.000Z', 5184000, 'Patriot Day'),
    (2, '2021-10-31T00:00:00.000Z', 5184000, 'Halloween'),
    (2, '2021-11-04T00:00:00.000Z', 5184000, 'Diwali'),
    (2, '2021-11-11T00:00:00.000Z', 5184000, 'Veterans'' Day'),
    (2, '2021-12-25T00:00:00.000Z', 5184000, 'Christmas Day'),
    (2, '2021-12-26T00:00:00.000Z', 5184000, 'Kwanzaa'),
    (2, '2021-12-31T00:00:00.000Z', 5184000, 'New Year''s Eve');
