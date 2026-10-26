-- DRAFT ONLY: requires separate manager approval before applying to a real database.
CREATE TABLE engine22_wave_events (
 event_id text PRIMARY KEY, instrument_context_id text NOT NULL,
 degree text NOT NULL, count_id text, event_type text NOT NULL,
 disposition text NOT NULL, idempotency_key text UNIQUE NOT NULL,
 payload_hash text NOT NULL, payload jsonb NOT NULL
);
CREATE TABLE engine22_wave_active_pointers (
 instrument_context_id text NOT NULL, degree text NOT NULL,
 active_count_id text, pointer_version bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (instrument_context_id,degree)
);
