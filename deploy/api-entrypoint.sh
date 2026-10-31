#!/bin/sh
# Derives the passkey and media settings from the one public address, TALEART_URL, unless they are set.
set -eu
if [ -n "${TALEART_URL:-}" ]; then
  url="${TALEART_URL%/}"
  host="${url#*://}"; host="${host%%/*}"; host="${host%%:*}"
  export RP_ORIGIN="${RP_ORIGIN:-$url}"
  export RP_ID="${RP_ID:-$host}"
  export PUBLIC_API_URL="${PUBLIC_API_URL:-$url}"
fi
exec "$@"
