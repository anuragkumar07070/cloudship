# CloudShip

CloudShip takes a GitHub repository URL and turns it into one or more running
Docker containers reachable at a stable URL, without requiring the repository to
ship any Docker configuration.

## Architecture — the seven stages

1. **Clone** — shallow clone into `/tmp/cloudship/<id>` (workspace wiped first).
2. **Compose short-circuit** — if `docker-compose.yml` / `compose.yml` exists at
   the repo root, `docker compose up -d --build` is invoked and stages 3–6 are
   skipped. Only env vars are collected at confirmation.
3. **Scan** — recursively find `package.json` files. Skip `node_modules`,
   `.git`, `dist`, `build`, `.next`. A `package.json` marks a service root and
   stops further descent — unless it declares `workspaces`, in which case it is
   treated as a monorepo root and the walk continues.
4. **Classify** — first matching rule wins:
   1. `Dockerfile` present → `dockerfile-provided`
   2. bundler (`vite` | `react-scripts`) **and** UI framework (`react`,
      `react-dom`, `vue`) → `static-site`
   3. server framework (`express`, `fastify`, `koa`, `@nestjs/core`) →
      `node-server`
   4. otherwise → `unknown`
   Also detects Vercel-serverless incompatibility (`vercel.json` + `api/`).
5. **Confirm** — an editable manifest form. The cross-service env-var fields
   appear **only** when both a `static-site` and a `node-server` are present.
   On submit, the confirmed manifest is written to
   `<workspace>/.cloudship/manifest.json` and never re-derived.
6. **Build** — URLs are assigned *before* building because a static site's API
   URL is compiled into its bundle. Dockerfiles are generated for services that
   didn't ship one, and written only to the workspace copy.
7. **Run and expose** — containers run on a per-deployment network with no
   published host ports. Health checks poll each container's declared port;
   on timeout the container's logs are captured into the failure record. Public
   services get reverse-proxy routes, then the deployment is marked `running`.

## Failure handling

Every stage updates the deployment status and appends to the deployment log.
On any failure, teardown removes containers, the network, built images, proxy
routes, and the workspace. Partial deployments never leave orphaned resources.
The failure log is retained.

## State

SQLite (`better-sqlite3`) with tables `deployments`, `services`, and
`env_vars`. Environment variable *values* are never written to the log stream —
the logger is built with a redactor that masks any occurrence of a secret value.
A small in-process queue limits concurrent deployments to
`CLOUDSHIP_CONCURRENCY` (default 1).

## Reverse proxy

A single `nginx:alpine` container (`cloudship-proxy`) mounts
`data/proxy/conf.d` and listens on port 80 of the host. Each deployment writes
one server block per public service into that directory and issues
`nginx -s reload`. This is deliberately minimal — swapping in Traefik or Caddy
only requires replacing `src/proxy/proxy.js`.

## Setup

```bash
# 1. Backend
npm install
npm start                # http://localhost:4000

# 2. Dashboard (dev)
cd dashboard && npm install && npm run dev   # http://localhost:5173