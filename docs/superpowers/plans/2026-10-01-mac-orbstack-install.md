# MoneyMatter on macOS with OrbStack Installation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to carry out this plan task by task. Use the repository-required test runner for tests. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install the tested MoneyMatter fork on the user's Mac using the existing OrbStack engine, with a Dock icon, persistent data, working precious-metal quotes, and a verified backup.

**Architecture:** Build the frontend and backend from the local feature commit and run the existing five-service self-hosting Compose stack. Initially expose only the frontend on the Mac's loopback interface. OrbStack manages the containers; Safari's installed web app provides the Dock icon.

**Tech Stack:** OrbStack, Docker Compose, Node 24.21.0 production images, nginx, PostgreSQL 16, Redis 7, currency-rates-api, Safari.

**Spec:** The user's installation requirements in this conversation, [precious-metals documentation](../../physical-precious-metals.md), and the [self-hosting guide](../../../self-hosting/docs/setup-guide.md).

## Global Constraints

- The user has authorized installation on the Mac and pushing the feature branch to their GitHub fork. Installation remains pending in the Mac session.
- Use OrbStack, not another container engine. Confirm the Docker context before each installation session.
- Install application commit `d120a412` on `feat/physical-precious-metals`, including feature `7d8a8d76` and fixes `0116a5a9`.
- Authorization covers the feature branch in `Rogue-Revenue/moneymatter` and this local Mac installation. Published images, deployment elsewhere, paid services, bank connections, and upstream contact remain outside scope.
- Use synthetic data for verification. Do not import real financial data during the installation smoke test.
- Confirmed: this is the first MoneyMatter installation on the Mac. Working assumption: Mac-only access. Confirm access scope and processor before execution.
- Preserve existing databases, volumes, ports, and secrets. Never use `down -v` or volume pruning as an installation remedy.
- Keep `.env` and backups private and outside version control. Preserve existing auth/encryption secrets if migrating an installation.

## Review Focus

- Wrong Docker context or an existing stack: preflight must establish that commands target OrbStack and that existing data is preserved.
- Apple Silicon versus Intel images: verify the currency service architecture and startup; do not assume an amd64-only image will start automatically.
- Accidentally running upstream MoneyMatter: separate local image tags and verify the precious-metals UI and API after startup.
- Lost data or changed credentials after restart/restore: exercise both persistence and a separate backup restoration.
- Sleeping Mac or stopped OrbStack: the Dock icon opens the website; serving it and refreshing prices require the Mac and containers to be running.

## Installation Files

| File/location                               | Purpose                                                           |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `~/Services/moneymatter/`                   | Mac checkout of the committed feature branch                      |
| `self-hosting/.env`                         | Private Mac runtime configuration and generated secrets           |
| `self-hosting/docker-compose.mac.local.yml` | Local image names and isolated Docker network                     |
| `.git/info/exclude`                         | Keep the Mac-only overlay out of source control                   |
| `~/MoneyMatterBackups/`                     | Restricted-access database, attachment, and configuration backups |
| Safari's MoneyMatter web app                | Dock/Applications launcher; no native wrapper needed              |

### Task 1: Prepare the Mac and Transfer the Exact Source

- [ ] Confirm macOS version, processor, and whether access is Mac-only. On macOS 14 or later, Safari supports Add to Dock. Record a different browser shortcut choice if the Mac runs an older release.
- [ ] Open OrbStack. Inspect `docker context ls`, then verify `docker --context orbstack info` and `docker --context orbstack compose version`. If the installed context has another name, use that verified context consistently in the commands below.
- [ ] Inspect existing Compose projects/volumes and whether port 8080 is occupied. Use project name `moneymatter` only if it is unused or is the intended existing installation. If port 8080 belongs to another app, use 18080 and update both app URLs to match.
- [ ] Check available disk and memory before building. Plan approximately 10–20 GB free disk and enough memory for the frontend build; the repository's 2 GB runtime minimum is not a build-memory guarantee.
- [ ] Clone `feat/physical-precious-metals` from `https://github.com/Rogue-Revenue/moneymatter.git` into `~/Services/moneymatter`. Preserve an existing checkout if that directory is occupied.
- [ ] Verify that the branch contains application commit `d120a412` and read this plan from the branch tip. For the initial build, check out `d120a412` and confirm `git rev-parse --short=8 HEAD` prints that revision. Do not pull or push during installation.

### Task 2: Configure the Local Stack

- [ ] In the Mac checkout's `self-hosting/` directory, copy `.env.example` to `.env` without overwriting an existing file; restrict it with `chmod 600 .env`.
- [ ] For a new installation, generate four distinct values with `openssl rand -base64 32` for `APPLICATION_JWT_SECRET`, `APP_SESSION_ID_SECRET`, `BETTER_AUTH_SECRET`, and `APPLICATION_DB_PASSWORD`. Store them directly in the private configuration; do not post them in chat. Leave the template's internal database/Redis hostnames intact.
- [ ] Set the following runtime values for the default Mac-only port. Keep optional analytics, email, bank, and AI credentials unset.

```dotenv
HTTP_PORT=127.0.0.1:8080
BETTER_AUTH_URL=http://localhost:8080
AUTH_ORIGIN=http://localhost:8080
OFFLINE_MODE=false
PRECIOUS_METALS_PRICE_PROVIDER=gold-api
SYSTEM_MAX_SIGNUPS_ALLOWED=1
```

- [ ] Create `docker-compose.mac.local.yml` with the following content and add its relative path to `.git/info/exclude`. The project-derived network name also permits an isolated restore test.

```yaml
services:
  backend:
    image: moneymatter-local/backend:d120a412
    pull_policy: never
  frontend:
    image: moneymatter-local/frontend:d120a412
    pull_policy: never

networks:
  budget-tracker:
    name: ${COMPOSE_PROJECT_NAME}-network
```

- [ ] Inspect the published `letehaha/currency-rates-api:latest` manifest. The repository currently documents amd64-only coverage. On Apple Silicon, if still amd64-only, add `currency-rates-api: { platform: linux/amd64 }` under `services` in the local overlay and verify OrbStack's emulation can run it. Build the frontend/backend natively for the Mac; do not force the entire stack to amd64.
- [ ] From `self-hosting/`, define the following session helper. Use the same project and all three files for subsequent operations.

```bash
mm() {
  docker --context orbstack compose --project-name moneymatter \
    --env-file .env \
    -f docker-compose.yml \
    -f docker-compose.build.yml \
    -f docker-compose.mac.local.yml "$@"
}
```

- [ ] Run `mm config --quiet`. Inspect non-secret portions of the resolved configuration locally: frontend binds only `127.0.0.1`, app images have the local tags, the network is `moneymatter-network`, and database/Redis ports are not published. Do not paste resolved secrets into logs or chat.

**If other-device access is selected:** Replace the loopback design with one stable LAN or HTTPS origin, and set both auth URLs to it before startup. For outside-home access, plan the chosen VPN/reverse proxy and HTTPS first. Do not expose the database or Redis. The localhost commands above are deliberately limited to the Mac and must be revised for that requirement.

### Task 3: Build and Start the Production Containers

- [ ] Run `mm pull db redis currency-rates-api` and record the resulting image digests for repeatability. Backend/frontend must come from the checked-out fork, not the upstream published app images.
- [ ] Run `mm build backend frontend`. This validates the actual production Dockerfiles, including native dependencies, migrations packaged in the backend, and frontend/landing builds. Capture failures before changing architecture or dependencies.
- [ ] Run `mm up -d --no-build --wait --wait-timeout 600`. The backend entrypoint runs migrations before serving requests; do not run a second migration process concurrently.
- [ ] Check `mm ps`: database, Redis, currency service, and backend must be healthy; frontend must be running. Review relevant startup logs for migration or architecture errors.
- [ ] Check `mm exec -T backend wget -qO- http://localhost:8081/health` returns a healthy JSON response, then open `http://localhost:8080` and verify the sign-in/registration screen and its API requests load successfully.

### Task 4: Verify the Installed App with Synthetic Data

- [ ] Register a temporary synthetic user and set its base currency. Verify sign-out/sign-in, then create a synthetic cash account and an ordinary expense to confirm basic account/budget behavior.
- [ ] Create gold, silver, and platinum holdings. Include gross and fine weight entries, one unknown-cost opening lot, two known-cost lots, a purchase, and a partial FIFO sale. Check quantities, fine weight, known basis, and unknown-cost gain handling.
- [ ] Use the app's automatic refresh and verify all three live quotes show the correct symbol, USD currency, source and timestamp. Compare a two-fine-troy-ounce holding against twice its observed quote. Repeat refresh and confirm the stored quote timestamps do not change while cached; do not repeatedly poll the provider.
- [ ] Match a synthetic purchase to an existing cash expense, then unlink it. Confirm cash balance and transaction count do not duplicate, linked spending is excluded from budgets, and metal value appears once in net worth.
- [ ] Record a manual quote and confirm manual pricing remains usable. Confirm historical views do not populate dates before an observed or explicitly dated quote.
- [ ] Run `mm restart`; sign in again and confirm holdings, lots, account data, and quote history persist. Check the browser console and container logs for relevant errors.

### Task 5: Prove Backup and Restore

- [ ] Create a private backup directory and capture a PostgreSQL dump, attachments archive, the matching `.env` through a secure local backup method, and the source/image version list. Use a full database backup to preserve global observed quote history; individual in-app backups exclude shared market-feed quotes.
- [ ] For the dump, use the repository's container-side credentials rather than passing passwords on the command line:

```bash
set -o pipefail
umask 077
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
mm exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > "$HOME/MoneyMatterBackups/moneymatter-$backup_stamp.sql.gz"
```

- [ ] Restore into a second checkout/project named `moneymatter-restore`, with its own configuration, volumes, network and port 8082. Keep this verification stack offline. Confirm the original stack is unaffected and that synthetic holdings, FIFO basis, attachments, and historical quotes match the backup. Do not test restoration over the original database.
- [ ] Remove only the temporary restore resources after verification. Keep the verified backup and document the restore commands used. Arrange regular backups to storage that is also protected if the Mac or OrbStack disk is lost.

### Task 6: Add the Dock Icon and Validate Everyday Startup

- [ ] Enable OrbStack startup at login. Keep the existing `restart: unless-stopped` policies. Confirm a normal Mac restart/login brings the stack back without a terminal command; manually stopped containers require `mm up -d` again.
- [ ] In Safari on macOS 14+, open the final app URL and use **File → Add to Dock**, naming it **MoneyMatter**. Confirm the icon opens the correct app window and supports sign-in.
- [ ] Test sleep/wake and a normal restart/login. Confirm the Dock app reconnects once OrbStack and the containers are ready. Document that serving the app and refreshing quotes pause while the Mac is asleep or off; daily caching does not require it to run continuously.
- [ ] Delete the temporary synthetic user/data after preserving the smoke-test results. The user can then create the real account. Keep the one-user signup limit unless household access is requested.
- [ ] Hand over the installed commit, image versions, local URL, OrbStack project name, startup/stop commands, private configuration location and verified backup procedure. Mark each unresolved check explicitly.

## Completion Criteria

Installation is ready for use when the production images build on the Mac, all required services are healthy, the synthetic flows and three live-metal quotes pass, restart and backup restoration preserve data, and the Dock icon works after login. Previous Linux application tests are supporting evidence; they do not substitute for these Mac/OrbStack checks.

Future updates should back up data, select a tested fork commit, build new local image tags and start the same Compose project. Avoid a blanket upstream app-image pull that would replace the precious-metals fork. Keep the prior image tags and backup until the update is verified; after a schema change, restoring the matching backup may be required for rollback.
