#!/bin/sh
# The dashboard answers only for the host names in NG_ALLOWED_HOSTS: take it from TALEART_URL unless set.
set -eu
if [ -n "${TALEART_URL:-}" ] && [ -z "${NG_ALLOWED_HOSTS:-}" ]; then
  host="${TALEART_URL#*://}"; host="${host%%/*}"; host="${host%%:*}"
  export NG_ALLOWED_HOSTS="$host"
fi
exec "$@"
