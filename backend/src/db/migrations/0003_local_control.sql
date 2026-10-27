-- Local control on the home Wi-Fi: a per-home PIN (encrypted) and each board's local address.
ALTER TABLE homes ADD COLUMN local_pin_enc bytea;
ALTER TABLE controllers ADD COLUMN lan_ip inet, ADD COLUMN local_name text;
ALTER TYPE event_source ADD VALUE IF NOT EXISTS 'local';
