-- Enable spoke-to-spoke transfer routes (Mooca ↔ SBC) as fallback when Osasco
-- cannot supply. These routes are disabled by default so that the engine only
-- activates them programmatically; the `enabled` flag is checked by future
-- admin UI but not yet by the engine (engine uses DEFAULT_TRANSFER_CONFIG).
INSERT INTO fleet.transfer_constraint (from_hub, to_hub, enabled, transit_days, min_qty, cadence)
VALUES
  ('mooca', 'sbc', true, 1, 1, 'weekly'),
  ('sbc',   'mooca', true, 1, 1, 'weekly')
ON CONFLICT (from_hub, to_hub) DO UPDATE
  SET enabled      = excluded.enabled,
      transit_days = excluded.transit_days,
      min_qty      = excluded.min_qty,
      cadence      = excluded.cadence;
