-- Migration: add status/note/timestamp columns to upc_sessions
-- Run this in Supabase SQL Editor

ALTER TABLE upc_sessions
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'In Progress',
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Backfill created_at from saved_at for existing rows
UPDATE upc_sessions
SET created_at = saved_at
WHERE created_at IS NULL AND saved_at IS NOT NULL;
