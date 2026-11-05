-- Migration: add drop_name to season_ledger
-- Run this in the Supabase SQL Editor (project → SQL Editor → New query)

ALTER TABLE season_ledger
  ADD COLUMN IF NOT EXISTS drop_name text;
