#!/bin/bash
# ==========================================================
# PostgreSQL Query Analysis Tools for Sanctuary
# ==========================================================
# Usage: ./scripts/db-analyze.sh [command]
#
# Commands:
#   slow         - View slow queries from PostgreSQL logs
#   stats        - Show database statistics and index usage
#   locks        - Show current locks and blocking queries
#   vacuum       - Run ANALYZE on all tables (updates stats)
#   explain <q>  - Run EXPLAIN ANALYZE on a query
# ==========================================================

set -e

# Get container name
CONTAINER="${POSTGRES_CONTAINER:-sanctuary-postgres-1}"
DB_USER="${POSTGRES_USER:-sanctuary}"
DB_NAME="${POSTGRES_DB:-sanctuary}"

psql_cmd() {
  docker exec -it "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "$1"
}

case "${1:-help}" in
  slow)
    echo "=== Recent Slow Queries (>1s) ==="
    docker logs "$CONTAINER" 2>&1 | grep -E "duration: [0-9]{4,}\.[0-9]+ ms" | tail -50
    ;;

  stats)
    echo "=== Database Size ==="
    psql_cmd "SELECT pg_size_pretty(pg_database_size('$DB_NAME')) as db_size;"

    echo ""
    echo "=== Table Sizes ==="
    psql_cmd "SELECT
      schemaname || '.' || tablename as table,
      pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as total_size,
      pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) as table_size,
      pg_size_pretty(pg_indexes_size(schemaname||'.'||tablename)) as index_size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    LIMIT 15;"

    echo ""
    echo "=== Index Usage (low usage may indicate unused indexes) ==="
    psql_cmd "SELECT
      schemaname || '.' || relname as table,
      indexrelname as index,
      idx_scan as index_scans,
      idx_tup_read as rows_read,
      pg_size_pretty(pg_relation_size(indexrelid)) as index_size
    FROM pg_stat_user_indexes
    ORDER BY idx_scan ASC
    LIMIT 15;"

    echo ""
    echo "=== Table Stats (sequential scans may indicate missing indexes) ==="
    psql_cmd "SELECT
      schemaname || '.' || relname as table,
      seq_scan,
      seq_tup_read,
      idx_scan,
      n_live_tup as row_count
    FROM pg_stat_user_tables
    WHERE seq_scan > 0
    ORDER BY seq_scan DESC
    LIMIT 10;"
    ;;

  locks)
    echo "=== Current Locks ==="
    psql_cmd "SELECT
      pid,
      usename,
      pg_blocking_pids(pid) as blocked_by,
      query_start,
      state,
      left(query, 100) as query_preview
    FROM pg_stat_activity
    WHERE state != 'idle'
    ORDER BY query_start;"
    ;;

  vacuum)
    echo "=== Running ANALYZE on all tables ==="
    psql_cmd "ANALYZE VERBOSE;"
    ;;

  explain)
    if [ -z "$2" ]; then
      echo "Usage: $0 explain \"SELECT ...\""
      exit 1
    fi
    echo "=== EXPLAIN ANALYZE ==="
    psql_cmd "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) $2"
    ;;

  help|*)
    echo "PostgreSQL Query Analysis Tools"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  slow         View slow queries from PostgreSQL logs (>1s)"
    echo "  stats        Show database statistics and index usage"
    echo "  locks        Show current locks and blocking queries"
    echo "  vacuum       Run ANALYZE on all tables (updates planner stats)"
    echo "  explain <q>  Run EXPLAIN ANALYZE on a query"
    echo ""
    echo "Examples:"
    echo "  $0 slow"
    echo "  $0 stats"
    echo "  $0 explain \"SELECT * FROM transactions WHERE wallet_id = 'abc'\""
    ;;
esac
