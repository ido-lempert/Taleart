#!/bin/sh
# One origin for the whole install. TALEART_URL decides the mode:
#   https://taleart.example.com  -> Caddy gets and renews a certificate for that name (ports 80 and 443)
#   http://localhost:8080 (or any http:// address) -> plain HTTP on port 80 inside the container
set -eu
url="${TALEART_URL:?TALEART_URL is not set}"
case "$url" in
  https://*) host="${url#https://}"; export TALEART_SITE="${host%%[/:]*}" ;;
  http://*)  export TALEART_SITE=":80" ;;
  *) echo "TALEART_URL must start with http:// or https:// (got: $url)" >&2; exit 1 ;;
esac
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
