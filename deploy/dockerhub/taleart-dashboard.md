# taleart-dashboard

The dashboard of [Taleart](https://github.com/ido-lempert/Taleart): the Angular app with server-side rendering, on Node 22 (alpine). Runs as the non-root `node` user and listens on port 4000.

It is one half of the self-host stack. Run it with the API, a Postgres database and a proxy through the compose file in the repository, not on its own.

## Quick start

```bash
git clone https://github.com/ido-lempert/Taleart.git && cd Taleart
cp .env.docker.example .env      # set TALEART_URL and POSTGRES_PASSWORD
TALEART_VERSION=latest docker compose pull
TALEART_VERSION=latest docker compose up -d
```

Open `TALEART_URL` and create the first admin. Set `TALEART_SEED_DEMO=true` first to start with a demo project.

## Tags

- `latest`, `0.1.0`, `0.1`: releases
- `edge`: the current `main` branch

Platforms: `linux/amd64`, `linux/arm64`.

## Configuration and docs

Environment variables, backups, running behind your own proxy: [Install with Docker](https://taleart.lempert.site/docker) and [deploy/README.md](https://github.com/ido-lempert/Taleart/blob/main/deploy/README.md).

Licence: Apache-2.0.
