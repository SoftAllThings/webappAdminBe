-- Migration 007: partial indexes for the admin review queue ("Begin Review")
--
-- Without these, findAll's COUNT(*) and getLastTypeVerified seq-scan the whole
-- app.poop table (~139k rows / 102MB) and exceed the client query_timeout.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- Run each statement SEPARATELY (one at a time in the Supabase SQL editor),
-- or via: npm run migrate-007
--
-- Supabase enforces a server-side statement_timeout that can cancel the build
-- (error 57014); lift it for the session first:
--   SET statement_timeout = 0;
--
-- If a build is interrupted it leaves an INVALID index that IF NOT EXISTS will
-- silently skip. Check with the verification query at the bottom; if invalid:
--   DROP INDEX CONCURRENTLY app.<name>;  then re-run the CREATE.

-- Serves PoopRepository.findAll: COUNT(*) becomes an index-only scan, and the
-- page query (ORDER BY created_at DESC LIMIT/OFFSET) reads in order with no
-- filtering. Predicate must match findAll()'s base WHERE clause exactly.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_poop_review_queue_created_at
  ON app.poop (created_at DESC)
  WHERE image_good_for_ml IS NULL AND skipped IS NOT TRUE;

-- Serves PoopRepository.getLastTypeVerified (ORDER BY first_check_date DESC LIMIT 1).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_poop_verified_first_check_date
  ON app.poop (first_check_date DESC)
  WHERE image_good_for_ml = TRUE;

ANALYZE app.poop;

-- Verification (both rows must show indisvalid = true):
--   SELECT i.relname, x.indisvalid
--     FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
--    WHERE i.relname IN ('idx_poop_review_queue_created_at',
--                        'idx_poop_verified_first_check_date');
