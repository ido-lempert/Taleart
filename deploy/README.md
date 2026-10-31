# Self-hosting TaleArt with Docker

One `docker compose up` runs the whole install: PostgreSQL, the API, the dashboard and a small Caddy proxy
that gives them a single address (passkeys and the session cookie need the dashboard and the API on the same
origin).

```
browser ──► proxy (Caddy, :80/:443) ──┬─ /api/*  /delivery/*  /media/*  /sdk/*  ──► api (:3333) ──► db (postgres:16)
                                      └─ everything else ───────────────────────► dashboard (:4000, Angular SSR)
```

Only the proxy publishes ports. The database, the API and the dashboard are reachable only inside the compose
network.

## Requirements

Docker Engine 24+ with the Compose plugin (v2.24+), 2 GB of RAM for running it and about 6 GB free during the
first build (the images are built from this repository: Node 22, Nx, Angular). Works on amd64 and arm64.

## Quick try (about five minutes, nothing to configure)

```sh
git clone <this repository> taleart && cd taleart
docker compose --env-file .env.docker.example up -d --build
```

Open <http://localhost:8080>. The values in `.env.docker.example` are public placeholders (database password,
secret key, setup password turned on): use them only on your own machine.

## A real install

```sh
git clone <this repository> taleart && cd taleart
cp .env.docker.example .env
```

Edit `.env`:

1. `TALEART_URL=https://taleart.example.com`: the address people open. Point that name's DNS at the server and
   open ports 80 and 443; the proxy gets and renews the certificate by itself.
2. `TALEART_HTTP_PORT=80` and `TALEART_HTTPS_PORT=443`.
3. `POSTGRES_PASSWORD`: `openssl rand -hex 24`. Compose refuses to start while it is empty.
4. `TALEART_SECRET_KEY`: `openssl rand -base64 32`. Keep a copy: it encrypts the sign-in provider secrets
   stored in the database.
5. `TALEART_SETUP_PASSWORD=false` (the default) so the first admin must use a passkey.
6. `TALEART_SEED_DEMO=false` (the default when the variable is missing), so no demo project is made. The quick
   try file turns it on.

Then:

```sh
docker compose up -d --build
docker compose ps          # db, api, dashboard and proxy should be "healthy"
```

Open `https://taleart.example.com`.

## First run

The first visit shows the setup screen. Create the administrator there (a passkey, or a username and password
when `TALEART_SETUP_PASSWORD=true`); setup is available only until the first admin exists. Then create a
project, copy its key and add the Web SDK to your site:
`<script src="https://taleart.example.com/sdk/v1/taleart.js"></script>`.

## Demo data

A new install is empty, which makes for dull screens and screenshots. The demo seed fills it with a made-up
furniture store's campaign, "Spring Campaign" (brand "Nordic Home", fictional products, pictures drawn for this
repository): a theme, three zones (a ring bar, a rotating banner and a poster bar), five tale groups with
covers and tags, thirteen tales (pictures, text, buttons, a countdown, a promo code, a poll, a quiz, a rating
and a reaction; one scheduled, one hidden), a user list and a small team.

In the Docker quick try it is on (`TALEART_SEED_DEMO=true` in `.env.docker.example`): when the first admin
finishes setup, the API makes the project for them within a few seconds, through its own Management API. It
runs once, only for the first admin of an install that has no other user, and its short-lived token is revoked
at the end. Leave it `false` on a real install. Turning it on later does nothing: setup has happened already.

On any other install, an admin runs one command with an API token (Settings > API tokens in the dashboard):

```sh
export TALEART_API_URL=http://localhost:8080 TALEART_TOKEN=tat_...
taleart seed-demo --dry-run     # checks the install and says what it would make
taleart seed-demo
```

Each zone gets a zone key (so the zones read as installed); `taleart seed-demo` prints them once, and the dashboard's
rotate button shows a fresh one. A second run does nothing: a project called "Spring Campaign" is the marker. The command refuses an install
whose admin already has other projects; `--force` adds the demo anyway (as "Spring Campaign 2" when the first
one exists). The command makes everything but the team: no API token may create a user or an invitation, so
the team comes only with `TALEART_SEED_DEMO`: Pia (publisher), Elin (editor), Viktor (viewer, access ends in
14 days) and Olle (editor, access already ended) with `example.com` emails and no way to sign in (no passkey,
password or provider), and two pending invitations (publisher, viewer). A project cannot be deleted through
the API, so remove the demo by starting from a fresh database (`docker compose down -v`).

## Passkeys need https

Browsers register passkeys only on `https://` addresses and on `http://localhost`. `http://192.168.x.x` or an
`http://` name does not work: use a real domain with https, or `localhost`. The passkey is bound to the domain in
`TALEART_URL`; changing the domain later makes existing passkeys unusable.

## Environment variables

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `TALEART_URL` | yes | none | The public address (`https://taleart.example.com` or `http://localhost:8080`). Sets the passkey domain and origin, the public media/SDK URL and the dashboard's allowed host. `https://` turns on automatic certificates. |
| `POSTGRES_PASSWORD` | yes | none | Password of the `taleart` database user. |
| `TALEART_SECRET_KEY` | recommended | empty | 32 random bytes, base64. Without it the API refuses to save sign-in provider secrets. |
| `TALEART_SETUP_PASSWORD` | no | `false` | `true`: the first admin may use a username and password instead of a passkey. |
| `TALEART_SEED_DEMO` | no | `false` | `true`: right after the first admin finishes setup, make the demo project (see Demo data). Quick try only. |
| `TALEART_HTTP_PORT`, `TALEART_HTTPS_PORT` | no | `80`, `443` | Host ports of the proxy. |
| `TALEART_VERSION` | no | `local` | Tag of the images. `local` builds them here; `latest` or a version (`0.1.0`) pulls `lempert/taleart-api` and `lempert/taleart-dashboard` from Docker Hub (run `docker compose pull` first). |
| `TRUST_PROXY` | no | `1` | Proxies in front of the API (hop count or addresses); used for per-address rate limits. |
| `DELIVERY_RATE_LIMIT_BURST`, `DELIVERY_RATE_LIMIT_PER_SECOND` | no | built-in | Delivery API limit per visitor; burst `0` turns it off. |
| `DATABASE_POOL_MAX` | no | `20` | Database connections the API holds. |
| `SDK_BUILDS_KEPT` | no | `5` | Web SDK builds kept at their pinned URLs. |

The API also reads `PROJECT_MEDIA_MAX_FILES`, `PROJECT_MEDIA_MAX_BYTES`, `RP_ID`, `RP_ORIGIN` and
`PUBLIC_API_URL` (the last three are derived from `TALEART_URL`; set them in `docker-compose.yml` under `api`
only to override).

## Data and volumes

| Volume | Holds |
| --- | --- |
| `taleart_db-data` | the PostgreSQL data |
| `taleart_media` | uploaded media files (`/data/media` in the api) |
| `taleart_sdk-builds` | earlier Web SDK builds, so pages that pin them keep working |
| `taleart_caddy-data` | certificates (keep it, or Let's Encrypt limits may bite on re-issue) |

## Backups

```sh
# database
docker compose exec -T db pg_dump -U taleart -Fc taleart > taleart-$(date +%F).dump
# media files
docker run --rm -v taleart_media:/data -v "$PWD":/backup alpine tar czf /backup/media-$(date +%F).tgz -C /data .
# restore the database into an empty install
docker compose exec -T db pg_restore -U taleart -d taleart --clean --if-exists < taleart-2026-01-01.dump
```

Back up `.env` (the secret key in particular) with them.

## Upgrades

```sh
git pull
docker compose up -d --build
```

The API applies database migrations itself when it starts. They only go forward: take a database backup
before an upgrade, because there is no automatic way back to an older version.

## Logs, status, stopping

```sh
docker compose logs -f api            # structured JSON, one line per entry
docker compose logs -f proxy dashboard
docker compose ps
docker compose down                   # stops; data stays in the volumes
docker compose down -v                # stops AND DELETES the database, media and certificates
```

## Behind a reverse proxy you already run

Do not publish the bundled proxy; publish the api and the dashboard on loopback instead:

```sh
docker compose -f docker-compose.yml -f deploy/docker-compose.external-proxy.yml up -d --build
```

Set `TALEART_URL` to the address your proxy serves. Route `/api/`, `/delivery/`, `/media/` and `/sdk/` to
`127.0.0.1:3333` and everything else to `127.0.0.1:4000`, keep the original `Host` header, send
`X-Forwarded-For`, and allow bodies of at least 100 MB and requests of 300 s. nginx:

```nginx
server {
  server_name taleart.example.com;                # listen 443 ssl; certificates as usual
  client_max_body_size 110m;
  proxy_read_timeout 300s;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;  # one trusted hop: TRUST_PROXY=1
  proxy_set_header X-Forwarded-Proto $scheme;
  location ~ ^/(api|delivery|media|sdk)/ { proxy_pass http://127.0.0.1:3333; }
  location / { proxy_pass http://127.0.0.1:4000; }
}
```

If another proxy (a CDN, a load balancer) sits in front of yours, use `$proxy_add_x_forwarded_for` and set
`TRUST_PROXY=2`.

## Starting over

`docker compose down -v` deletes everything, including the administrator. To reset only the setup, restore a
database backup. Changing `POSTGRES_PASSWORD` in `.env` after the first start does not change the existing
database user: change it with `ALTER USER taleart PASSWORD '...'` in `docker compose exec db psql -U taleart`.

## Limits

Uploads: media 100 MB, user-list CSV 50 MB, fonts 500 KB, covers 10 MB; the proxy adds no limit of its own and
no read timeout (the API allows a request 300 s). Images are built on the machine that runs compose; to build
for another architecture use `docker buildx build --platform linux/amd64 --target api -t taleart/api .`.
