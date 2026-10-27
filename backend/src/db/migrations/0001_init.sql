-- Voltix initial schema. Partitioned tables are created here by hand; Drizzle only maps them for queries.
CREATE EXTENSION IF NOT EXISTS citext;

-- ── Identity ────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text NOT NULL,
  name              text NOT NULL,
  email_verified_at timestamptz,
  is_platform_admin boolean NOT NULL DEFAULT false,
  disabled_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  family_id   uuid NOT NULL,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TYPE email_token_purpose AS ENUM ('verify', 'reset');
CREATE TABLE email_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    email_token_purpose NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  prefix       text NOT NULL UNIQUE,
  key_hash     text NOT NULL,
  scopes       text[] NOT NULL,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_keys_user_idx ON api_keys(user_id);

CREATE TABLE audit_log (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  actor_user_id    uuid,
  actor_api_key_id uuid,
  action           text NOT NULL,
  target_type      text,
  target_id        text,
  ip               inet,
  meta             jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at_idx ON audit_log(at);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_user_id, at);

-- ── Homes ───────────────────────────────────────────────────────────────────
CREATE TABLE homes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  timezone       text NOT NULL DEFAULT 'Asia/Kolkata',
  latitude       double precision,
  longitude      double precision,
  tariff_per_kwh numeric(10,4) NOT NULL DEFAULT 8,
  currency       char(3) NOT NULL DEFAULT 'INR',
  -- What plain members may do (owners/admins can always do everything)
  member_permissions jsonb NOT NULL DEFAULT '{"locks":true,"energy":true,"lighting":true,"climate":true}',
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE home_role AS ENUM ('owner', 'admin', 'member');
CREATE TABLE home_members (
  home_id    uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       home_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (home_id, user_id)
);
CREATE INDEX home_members_user_idx ON home_members(user_id);

CREATE TABLE home_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id     uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  email       citext NOT NULL,
  role        home_role NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX home_invites_home_idx ON home_invites(home_id);

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id    uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT 'sofa',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rooms_home_idx ON rooms(home_id);

-- ── Devices ─────────────────────────────────────────────────────────────────
CREATE TABLE device_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  key           text NOT NULL,
  name          text NOT NULL,
  icon          text NOT NULL DEFAULT 'box',
  capabilities  jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX device_templates_owner_key_uq ON device_templates(owner_user_id, key) NULLS NOT DISTINCT;

CREATE TABLE controllers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id          uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name             text NOT NULL,
  key_id           text NOT NULL UNIQUE,
  secret_enc       bytea NOT NULL,
  model            text,
  mac              text,
  firmware_version text,
  ip               inet,
  online           boolean NOT NULL DEFAULT false,
  last_seen_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX controllers_home_idx ON controllers(home_id);

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id       uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  room_id       uuid REFERENCES rooms(id) ON DELETE SET NULL,
  controller_id uuid REFERENCES controllers(id) ON DELETE SET NULL,
  channel       smallint,
  type          text NOT NULL,
  name          text NOT NULL,
  icon          text NOT NULL DEFAULT 'box',
  capabilities  jsonb NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}',
  favorite      boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_channel_uq UNIQUE (controller_id, channel)
);
CREATE INDEX devices_home_idx ON devices(home_id);
CREATE INDEX devices_room_idx ON devices(room_id);

CREATE TABLE device_state (
  device_id      uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  state          jsonb NOT NULL DEFAULT '{}',
  power_on_since timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── History (partitioned) ───────────────────────────────────────────────────
CREATE TYPE device_event_kind AS ENUM ('command', 'response', 'event', 'online', 'offline');
CREATE TYPE event_source AS ENUM ('app', 'api', 'scene', 'schedule', 'automation', 'physical', 'restore', 'system');

CREATE TABLE device_events (
  id            bigint GENERATED ALWAYS AS IDENTITY,
  at            timestamptz NOT NULL DEFAULT now(),
  home_id       uuid NOT NULL,
  device_id     uuid,
  controller_id uuid,
  kind          device_event_kind NOT NULL,
  action        text,
  value         jsonb,
  source        event_source NOT NULL,
  actor_user_id uuid,
  success       boolean,
  message       text,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE INDEX device_events_device_idx ON device_events(device_id, at DESC);
CREATE INDEX device_events_home_idx ON device_events(home_id, at DESC);

CREATE TABLE sensor_readings (
  device_id uuid NOT NULL,
  metric    smallint NOT NULL,
  ts        timestamptz NOT NULL,
  value     double precision NOT NULL
) PARTITION BY RANGE (ts);
CREATE INDEX sensor_readings_lookup_idx ON sensor_readings(device_id, metric, ts);
CREATE INDEX sensor_readings_ts_brin ON sensor_readings USING brin(ts);

CREATE TABLE sensor_rollups_hourly (
  device_id uuid NOT NULL,
  metric    smallint NOT NULL,
  hour      timestamptz NOT NULL,
  min       double precision NOT NULL,
  max       double precision NOT NULL,
  avg       double precision NOT NULL,
  count     integer NOT NULL,
  PRIMARY KEY (device_id, metric, hour)
);

CREATE TABLE energy_daily (
  device_id   uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  day         date NOT NULL,
  on_seconds  integer NOT NULL DEFAULT 0,
  wh_estimated numeric(14,3) NOT NULL DEFAULT 0,
  wh_measured  numeric(14,3),
  PRIMARY KEY (device_id, day)
);

-- ── Scenes & automations ────────────────────────────────────────────────────
CREATE TABLE scenes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id    uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name       text NOT NULL,
  icon       text NOT NULL DEFAULT 'sparkles',
  actions    jsonb NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX scenes_home_idx ON scenes(home_id);

CREATE TABLE automations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id     uuid NOT NULL REFERENCES homes(id) ON DELETE CASCADE,
  name        text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  trigger     jsonb NOT NULL,
  conditions  jsonb NOT NULL DEFAULT '[]',
  actions     jsonb NOT NULL,
  end_actions jsonb NOT NULL DEFAULT '[]',
  cooldown_s  integer NOT NULL DEFAULT 5,
  next_run_at timestamptz,
  next_edge   text,
  last_run_at timestamptz,
  last_status text,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automations_home_idx ON automations(home_id);
CREATE INDEX automations_due_idx ON automations(next_run_at) WHERE enabled AND next_run_at IS NOT NULL;

CREATE TABLE automation_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  trigger_info  jsonb,
  status        text NOT NULL,
  results       jsonb
);
CREATE INDEX automation_runs_idx ON automation_runs(automation_id, at DESC);

-- ── Notifications ───────────────────────────────────────────────────────────
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  home_id    uuid REFERENCES homes(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

CREATE TABLE notification_prefs (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type    text NOT NULL,
  in_app  boolean NOT NULL DEFAULT true,
  push    boolean NOT NULL DEFAULT true,
  email   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  last_success_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions(user_id);

-- ── OTA ─────────────────────────────────────────────────────────────────────
CREATE TABLE firmware_releases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model       text NOT NULL,
  version     text NOT NULL,
  file_path   text NOT NULL,
  size        integer NOT NULL,
  sha256      text NOT NULL,
  notes       text NOT NULL DEFAULT '',
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (model, version)
);

CREATE TYPE ota_target_status AS ENUM ('pending', 'offered', 'downloading', 'installing', 'succeeded', 'failed', 'timeout');
CREATE TABLE ota_rollouts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES firmware_releases(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ota_targets (
  rollout_id    uuid NOT NULL REFERENCES ota_rollouts(id) ON DELETE CASCADE,
  controller_id uuid NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
  status        ota_target_status NOT NULL DEFAULT 'pending',
  progress      smallint NOT NULL DEFAULT 0,
  error         text,
  offered_at    timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rollout_id, controller_id)
);
CREATE INDEX ota_targets_controller_idx ON ota_targets(controller_id);
