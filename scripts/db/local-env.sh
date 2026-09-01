# Source this to point libpq at the local verification cluster.
#   source scripts/db/local-env.sh && ./scripts/db/verify.sh --keep
export PGHOST=/var/lib/qros-pg/pgrun
export PGPORT=5433
export PGUSER=root
