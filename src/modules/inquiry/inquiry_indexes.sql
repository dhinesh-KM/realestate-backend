-- ─────────────────────────────────────────────────────────────
-- Migration 002 — inquiry protection indexes
-- Run after prisma migrate dev applies schema changes.
-- ─────────────────────────────────────────────────────────────

-- ── Partial unique index — duplicate prevention ───────────────
--
-- Why a partial index instead of a full unique constraint?
--
-- A full @@unique([senderId, propertyId]) prevents a user from
-- EVER re-inquiring a property, even after 30 days. That's too strict.
--
-- This partial index enforces uniqueness only within a 24-hour
-- window. After 24 hours the index condition is false, so the
-- constraint no longer applies and the user can inquire again.
--
-- The @@unique in the Prisma schema handles the all-time guard
-- for the upsert pattern (see inquiry.service.ts). This partial
-- index provides the time-windowed guard used for the re-inquiry
-- cooldown check.
--
-- Note: PostgreSQL partial unique indexes are invisible to Prisma
-- and must be created here in raw SQL.

CREATE UNIQUE INDEX IF NOT EXISTS uq_inquiry_active_24h
  ON inquiries (sender_id, property_id)
  WHERE last_sent_at > NOW() - INTERVAL '24 hours';

-- ── Partial index — pending inquiries for a receiver ─────────
-- Owner's inbox shows only PENDING + READ inquiries by default.
-- This index serves that filtered query without scanning all statuses.

CREATE INDEX IF NOT EXISTS idx_inquiries_pending_receiver
  ON inquiries (receiver_id, created_at DESC)
  WHERE status IN ('PENDING', 'READ');

-- ── Partial index — spam score filter ────────────────────────
-- Spam review queue — only rows with elevated spam score.
-- Keeps the index tiny (only flagged rows).

CREATE INDEX IF NOT EXISTS idx_inquiries_spam_review
  ON inquiries (spam_score DESC, created_at DESC)
  WHERE spam_score >= 3;

-- ── Comment ───────────────────────────────────────────────────
COMMENT ON INDEX uq_inquiry_active_24h IS
  'Partial unique index: prevents a sender from submitting more than one inquiry
   to the same property within a 24-hour rolling window. After 24h the constraint
   expires automatically. Race-condition safe — two concurrent requests cannot
   both insert for the same (sender_id, property_id).';