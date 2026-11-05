-- Migration: add invoice_num and order_num to season_ledger
-- Run this in the Supabase SQL Editor (project → SQL Editor → New query)

ALTER TABLE season_ledger
  ADD COLUMN IF NOT EXISTS invoice_num text,
  ADD COLUMN IF NOT EXISTS order_num   text;
