-- Waiting pushes go out when a phone registers (migration 20261014110000).
\set ON_ERROR_STOP on
\ir ../../migrations/20261014110000_push_token_requeue.sql
\ir ../../migrations/20261014110000_push_token_requeue.sql

INSERT INTO notification_push_outbox (recipient_user_id, status, next_attempt_at, expires_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'WAITING_TOKEN', now() + interval '25 min', now() + interval '2 days'),
  ('00000000-0000-0000-0000-000000000001', 'WAITING_TOKEN', now() + interval '25 min', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000001', 'SENT',          now() + interval '25 min', now() + interval '2 days'),
  ('00000000-0000-0000-0000-000000000002', 'WAITING_TOKEN', now() + interval '25 min', now() + interval '2 days');

INSERT INTO device_push_tokens (user_id, token, platform, device_id)
VALUES ('00000000-0000-0000-0000-000000000001', 'ExponentPushToken[a]', 'android', 'd1');
SELECT t_assert('registering requeues only that user''s live waiting pushes',
  (SELECT string_agg(x, ' ' ORDER BY x) FROM (
     SELECT recipient_user_id::text || ':' || status || ':' || (expires_at > now()) || ':' || (next_attempt_at <= now()) AS x
     FROM notification_push_outbox) o),
  (SELECT string_agg(x, ' ' ORDER BY x) FROM (VALUES
     ('00000000-0000-0000-0000-000000000001:SENT:true:false'),
     ('00000000-0000-0000-0000-000000000001:WAITING_TOKEN:false:false'),
     ('00000000-0000-0000-0000-000000000001:WAITING_TOKEN:true:true'),
     ('00000000-0000-0000-0000-000000000002:WAITING_TOKEN:true:false')) v(x)));

UPDATE notification_push_outbox SET next_attempt_at = now() + interval '25 min' WHERE status = 'WAITING_TOKEN';
UPDATE device_push_tokens SET updated_at = now(), active = true;
SELECT t_assert('heartbeat update of an active token requeues nothing',
  (SELECT count(*) FROM notification_push_outbox WHERE next_attempt_at <= now())::text, '0');

UPDATE device_push_tokens SET active = false;
UPDATE device_push_tokens SET active = true;
SELECT t_assert('re-activated token requeues', (SELECT count(*) FROM notification_push_outbox WHERE next_attempt_at <= now())::text, '1');
\echo 04_push_token_requeue: PASS
