#!/usr/bin/env bash
# Local, throwaway verification of the 2026-10-06 permission/security migrations.
# Needs PostgreSQL 15+ binaries (initdb, pg_ctl, psql) on PATH. Never point this at production.
# Usage (from repo root): bash supabase/tests/run_permission_tests.sh
set -euo pipefail
DATA=$(mktemp -d); PORT=${PORT:-54329}
initdb -D "$DATA" -U postgres -A trust -E UTF8 >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT" -l "$DATA/log" start >/dev/null; sleep 2
trap 'pg_ctl -D "$DATA" stop >/dev/null; rm -rf "$DATA"' EXIT
psql -p "$PORT" -U postgres -q -c "create database t"
psql -p "$PORT" -U postgres -d t -q -v ON_ERROR_STOP=1 -f supabase/tests/permission_mock_legacy_schema.sql
for run in 1 2; do   # twice: proves the migrations are re-runnable
  for f in 20261006100000_security_lockdown 20261006101000_lock_biometric_sync_rpc \
           20261006110000_permission_scope_values 20261006120000_scope_permission_engine \
           20261006130000_canonical_range_authorization 20261006140000_regularization_and_late_policy; do
    psql -p "$PORT" -U postgres -d t -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql"
  done
done
psql -p "$PORT" -U postgres -d t -q -f supabase/tests/permission_scenarios.sql 2>&1 | grep -E "PASS|FAIL|ERROR|ALL_SCENARIOS_DONE"
# Attendance correction + sane canonical times (20261006150000)
psql -p "$PORT" -U postgres -d t -q -v ON_ERROR_STOP=1 -f supabase/tests/correction_mock_schema.sql
for run in 1 2; do
  for f in 20261006150000_attendance_correction_and_sane_times 20261006160000_fix_canonical_wrapper_performance            20261006170000_checkout_rules_biometric_1830_auto_2000; do
    psql -p "$PORT" -U postgres -d t -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql"
  done
done
psql -p "$PORT" -U postgres -d t -q -f supabase/tests/correction_scenarios.sql 2>&1 | grep -E "PASS|FAIL|ERROR|CORRECTION_SCENARIOS_DONE"
psql -p "$PORT" -U postgres -d t -q -c "delete from attendance_audit_logs"
psql -p "$PORT" -U postgres -d t -q -f supabase/tests/checkout_rule_scenarios.sql 2>&1 | grep -E "PASS|FAIL|ERROR|CHECKOUT_RULE_SCENARIOS_DONE"

# Permission engine v2 + scoped HR panel + delegation (20261007100000..120000)
psql -p "$PORT" -U postgres -q -c "create database t2"
psql -p "$PORT" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f supabase/tests/permission_mock_legacy_schema.sql
for f in 20261006100000_security_lockdown 20261006110000_permission_scope_values 20261006120000_scope_permission_engine; do
  psql -p "$PORT" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql"
done
psql -p "$PORT" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f supabase/tests/permission_v2_mock_extra.sql
psql -p "$PORT" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -f supabase/tests/permission_delegation_mock.sql
for run in 1 2; do
  for f in 20261007100000_permission_engine_v2 20261007110000_scoped_admin_surface 20261007120000_permission_delegation; do
    psql -p "$PORT" -U postgres -d t2 -q -v ON_ERROR_STOP=1 -1 -f "supabase/migrations/$f.sql"
  done
done
psql -p "$PORT" -U postgres -d t2 -q -f supabase/tests/permission_v2_scenarios.sql 2>&1 | grep -E "FAIL|ERROR|passed|PERMISSION_V2_SCENARIOS_DONE"
psql -p "$PORT" -U postgres -d t2 -q -f supabase/tests/permission_delegation_scenarios.sql 2>&1 | grep -E "FAIL|ERROR|passed|DELEGATION_SCENARIOS_DONE"
