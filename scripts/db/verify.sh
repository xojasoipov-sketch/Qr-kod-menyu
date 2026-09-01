#!/usr/bin/env bash
# =============================================================================
# Restaurant QR OS — apply the whole migration chain to a throwaway database
# and report the first failure with its file and line.
#
#   ./scripts/db/verify.sh              # apply chain, stop at first error
#   ./scripts/db/verify.sh --keep       # leave the database in place afterwards
#
# Requires a reachable PostgreSQL 15+ superuser connection. Configure with the
# standard libpq variables (PGHOST, PGPORT, PGUSER) or the defaults below.
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${QROS_TEST_DB:-qros_verify}"
KEEP=0
[[ "${1:-}" == "--keep" ]] && KEEP=1

psql_super() { psql -v ON_ERROR_STOP=1 -X -q --no-psqlrc -d postgres "$@"; }
psql_db()    { psql -v ON_ERROR_STOP=1 -X -q --no-psqlrc -d "$DB" "$@"; }

echo "==> recreating database $DB"
psql_super -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
psql_super -c "CREATE DATABASE $DB;" >/dev/null

echo "==> bootstrapping Supabase-compatible roles, schemas and helpers"
if ! psql_db -f "$ROOT/scripts/db/bootstrap-supabase.sql" >/dev/null; then
  echo "FAILED: bootstrap" >&2
  exit 1
fi

echo "==> applying migrations"
failed=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if out="$(psql_db -f "$f" 2>&1)"; then
    printf '    ok   %s\n' "$name"
  else
    printf '    FAIL %s\n' "$name"
    printf '%s\n' "$out" | sed 's/^/         /'
    failed=1
    break
  fi
done

if [[ $failed -eq 0 && -f "$ROOT/supabase/seed.sql" ]]; then
  echo "==> applying seed"
  if out="$(psql_db -f "$ROOT/supabase/seed.sql" 2>&1)"; then
    printf '    ok   seed.sql\n'
  else
    printf '    FAIL seed.sql\n'
    printf '%s\n' "$out" | sed 's/^/         /'
    failed=1
  fi
fi

if [[ $failed -eq 0 && -d "$ROOT/scripts/db/tests" ]]; then
  echo "==> running security and behaviour tests"
  for t in "$ROOT"/scripts/db/tests/*.sql; do
    [[ -e "$t" ]] || continue
    name="$(basename "$t")"
    if out="$(psql_db -f "$t" 2>&1)"; then
      printf '    ok   %s\n' "$name"
    else
      printf '    FAIL %s\n' "$name"
      printf '%s\n' "$out" | sed 's/^/         /'
      failed=1
    fi
  done
fi

if [[ $KEEP -eq 0 && $failed -eq 0 ]]; then
  psql_super -c "DROP DATABASE IF EXISTS $DB WITH (FORCE);" >/dev/null
fi

if [[ $failed -eq 0 ]]; then
  echo "==> PASS"
else
  echo "==> FAIL (database $DB left in place for inspection)"
fi
exit $failed
