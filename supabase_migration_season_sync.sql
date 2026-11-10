-- Season Book ↔ SS/AW Module Sync
-- Run this in Supabase SQL editor

-- 1. Add link + adjustment columns to season_ss
ALTER TABLE season_ss
  ADD COLUMN IF NOT EXISTS season_book_id uuid REFERENCES season_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adj_qty integer,
  ADD COLUMN IF NOT EXISTS adj_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS adj_note text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Not Created';

-- 2. Add link + adjustment columns to season_aw
ALTER TABLE season_aw
  ADD COLUMN IF NOT EXISTS season_book_id uuid REFERENCES season_ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adj_qty integer,
  ADD COLUMN IF NOT EXISTS adj_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS adj_note text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'Not Created';

-- 3. app_settings rows for season activation are created dynamically
--    (key = 'season_active_SS27', value = 'true'/'false')
--    No schema change needed — app_settings already exists.

-- Status values:
--   'Not Created'  — linked from season book but no PO yet
--   'Pending'      — PO filled in
--   'Adjusted'     — adj_qty or adj_amount set (discrepancy logged)
--   'Cancelled'    — row is_cancelled in season book OR logged=false in module
