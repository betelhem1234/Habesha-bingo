# Deployment & Ops Guide

How the bot runs in the cloud, how to update it, and how to control everything.

**Mental model**

| Piece | Where it lives | What it does |
|-------|---------------|--------------|
| App (bot + admin site) | Render service `Habesha-bingo` | Runs the bot + web server. Stateless: restarts lose nothing except DB data if not stored in Postgres |
| Database | Neon Postgres (`neondb`) | All persistent data (users, pools, stats, migrations) |
| UptimeRobot | uptimerobot.com | Pings the site every 5 min so the free Render instance never falls asleep |
| Code | GitHub: `betelhem1234/Habesha-bingo`, branch `main` | Source of truth; every push triggers a redeploy |

## Quick reference

- App URL: https://habesha-bingo-17p0.onrender.com
- Render service ID: `srv-db0kfiad0e5s73c1f690`
- Neon dashboard: https://console.neon.tech (project `neondb`)

## 1. Deploying your code (normal daily flow)

1. Edit files under `src/`, `prisma/`, etc.
2. Commit and push:

```bash
git add -A
git commit -m "my change"
git push
```

3. Render auto-deploys (autoDeploy is on). Every deploy does:
   build image -> `prisma migrate deploy` -> start bot.
4. Wait ~30-60 s; the bot is briefly offline during the deploy, then back.

> **Known quirk:** right after a redeploy the new instance may log a one-time
> `409 Conflict: terminated by other getUpdates request`. That is just the old
> instance releasing the poll; Render auto-restarts the new one within a minute
> and it takes over — nothing to fix.

### Force a clean deploy (fixes build-cache glitches)

Use `./deploy.sh --clean` or on the Render dashboard:
`play-with-me` service -> **Manual Deploy** -> **Clear build cache & deploy**.

### Deploying a previous commit

On the dashboard: `play-with-me` -> Manual Deploy -> paste commit hash.

## 2. Controlling the app

### Environment variables

Render dashboard -> `play-with-me` -> **Environment**:

| Variable | Purpose |
|----------|---------|
| `BOT_TOKEN` | Telegram bot token (currently the test bot `@BetysNewGamebot`) |
| `DATABASE_URL` | Neon Postgres connection string (`sslmode=require`) |
| `ADMIN_USER_ID` | Your Telegram user id (admin) |
| `BINGO_APP_URL` | Public URL of the admin/web app |
| `PORT` | Must stay `8080` (Render expects it) |

Editing any value auto-triggers a redeploy. Secrets are never committed to git;
they live only here (and in your local `.env`).

### Logs

- Dashboard: service -> **Logs**
- Or CLI (from repo): `./logs.sh` (streams live) / `render logs -r srv-da8p9v4s728c73bsblmg`

### Restart a hung bot

Dashboard -> `play-with-me` -> **Manual Restart** (fastest fix).

## 3. Controlling the database (Neon)

The database is **not** on Render. Manage it at https://console.neon.tech:

- **Browse data:** Neon dashboard -> **Tables**
- **Run queries:** Neon dashboard -> **SQL Editor** (great for one-off fixes/tests)

### Schema changes (the important workflow)

Your PC cannot reach Neon directly, so you never run migrations from your machine.
Instead, generate the migration SQL offline from the schema diff:

1. Edit `prisma/schema.prisma`.
2. Generate the SQL (no database connection needed):

```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

3. Save the output as `prisma/migrations/<timestamp>_<name>/migration.sql`
   (new folder per change).
4. Commit + push. Render runs `prisma migrate deploy` on the next deploy,
   and the migration is applied to Neon automatically.

Migration history lives in the repo and is version-controlled.

### Quick manual changes during development

If you just want to tweak data fast, use the Neon SQL Editor directly.
Keep `prisma/schema.prisma` in sync with what you do there.

## 4. UptimeRobot (keep the free instance awake)

1. https://uptimerobot.com -> free sign-up (one-time)
2. Add monitor -> type **HTTP(s)** -> URL `https://habesha-bingo-17p0.onrender.com`
   -> interval **5 minutes**
3. Save. It pings the site every 5 min so Render never sleeps (your PC staying
   off is fine). Deploys are unaffected.

## 5. Two environments (dev local, release cloud)

| | Local (your PC) | Cloud (Render) |
|---|---|---|
| Bot | `@MyBingoTestBot` | `@PlayMyBingoBot` |
| Database | local Postgres | Neon (`neondb`) |
| Started with | `bash run.sh` | `./deploy.sh "message"` |
| Purpose | Develop and test changes | Released version testers use |

**Workflow**
1. Develop and test locally using your test bot token in `.env`.
2. When the change is good, release it: `./deploy.sh "my update"`.
   `deploy.sh` verifies Render's `BOT_TOKEN` is `@PlayMyBingoBot` and aborts if
   not, then pushes and waits for the cloud deploy.
3. Players use **`@PlayMyBingoBot`**.

Both bots run the same code and schema.

> A bot token can only be polled by one process at a time. Never run the same
> token locally and on Render together (the cloud is always `@PlayMyBingoBot`;
> the local PC is your test bot).
> systemd bot before running to avoid the 409 conflict.

## 6. Helper scripts

- `./deploy.sh` - checks Render's bot is `@BetysNewGamebot`, then commits/pushes
  and waits for the auto-deploy (use `--clean` for a clear-cache deploy)
- `./logs.sh` - stream live logs from the service

Both need the Render API key in your environment (`RENDER_API_KEY`) or saved at
`~/.render/api-key`. Run `cp` of your key to `~/.render/api-key` once to make
them work everywhere.