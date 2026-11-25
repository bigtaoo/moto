# The telemetry collector

The game's own analytics wire, for the hosts whose backend collects nothing for us. `src/collect.ts`
batches every event and posts it here; `wire.ts` is the contract both ends import, so they cannot
drift apart without the typechecker saying so.

- `https://dx.gamestao.com/c` — where the game posts. It is in the build (`.env.production`), so it
  is public: anything that keeps the data clean has to be in `wire.ts`, not in secrecy.
- One file per UTC day, `data/events-YYYY-MM-DD.ndjson`, one JSON line per batch, exactly as stored.
- No addresses, ever. The country Cloudflare's edge puts on the request is kept; the address it came
  from is used for the minute's rate counting, in memory, and is written down nowhere.

## Where it runs

On the box blight bloom owns (`blightbloom`, Hetzner, Helsinki), as **its own compose project** in
`/home/deploy/dummy-brawl` — beside Potion Siege, Holy Kicker and fight, and apart from all of them,
so a deploy of any of those cannot disturb this one or the other way round.

Ports 80 and 443 on that box are blight bloom's Caddy. This project publishes no port at all:
`dx-tunnel` (cloudflared) dials out, and Cloudflare serves `dx.gamestao.com` down that connection to
`collector:8787`. That is also what puts `cf-connecting-ip` and `cf-ipcountry` on every request, which
is the whole of what `limits.ts` reads — nothing else can reach the port to set them.

| container | what it is |
| --- | --- |
| `dx-collector` | `node main.ts`, 128 MB, `./data` mounted at `/data` |
| `dx-tunnel` | cloudflared, the only way in |
| `dx-backup` | a gzipped copy of yesterday's file at 03:20 UTC, kept 30 days |

## Endpoints

| | |
| --- | --- |
| `POST /c` | a batch from the game. 204, or 400 (wire.ts refused it), 413 (over 64 KB), 429 (over the minute's budget), 507 (the day's file is at its cap) |
| `GET /export?day=YYYY-MM-DD` | that day's lines, streamed. Bearer `EXPORT_TOKEN` |
| `GET /days` | which days hold data. Bearer `EXPORT_TOKEN` |
| `GET /health` | 200 while the disk takes writes and has 256 MB free; the container healthcheck |
| `GET /` | one line saying what this is |

Without `EXPORT_TOKEN` set, `/export` and `/days` answer 404 — no token, no door — and collecting
carries on regardless, which is why a missing one is a warning in the log rather than a refusal to
start.

## No build step

Node 22.18+ runs TypeScript directly, stripping the types as it loads. There is no bundler, no
`node_modules` in the image and nothing to build before a deploy: the four files are copied in as they
are. That is why their imports name each other with the `.ts` extension, and why
`server/tsconfig.json` sets `erasableSyntaxOnly` — an enum or a parameter property would typecheck
and then crash in the container.

Run it locally the same way the container does:

```sh
PORT=8899 COLLECT_DIR=/tmp/dx EXPORT_TOKEN=local node server/main.ts
```

## Installing it on the box (once, by hand)

`Dockerfile` and `docker-compose.yml` decide what runs and with which mounts, so they never come from
CI. They are installed by hand, root-owned, and `ci-deploy.sh` refuses to deploy unless they still
hash to the values written into it (`server/deploy.test.ts` keeps those hashes equal to the files
here: edit either file and the test goes red until the hash is updated — which is the reminder to
install the file on the box again).

1. **Make the tunnel.** Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel (Cloudflared),
   name it `dummy-brawl`. Add one public hostname: `dx` on `gamestao.com` → HTTP →
   `http://collector:8787`. Copy the connector token. The DNS record Cloudflare creates for it is
   orange-clouded, which is what we want here — the opposite of `bb.gamestao.com`, which has to stay
   grey so Caddy's ACME challenge works.

2. **Put the two secrets in `.env`.** Paste them yourself; they never go through a config file in this
   repo and never through CI's logs:

   ```
   DX_TUNNEL_TOKEN=<the connector token>
   DX_EXPORT_TOKEN=<a long random string you keep>
   ```

   From a shell that has a real Ctrl-D, that is a pipe:

   ```sh
   ssh blightbloom 'umask 077; cat > /home/deploy/dummy-brawl/.env; chown deploy:deploy /home/deploy/dummy-brawl/.env'
   ```

   From Windows it is easier to keep the file in the credential store beside the key and send it:

   ```powershell
   scp D:\cloud\dummy-brawl.env blightbloom:/home/deploy/dummy-brawl/.env
   ssh blightbloom 'chmod 600 /home/deploy/dummy-brawl/.env; chown deploy:deploy /home/deploy/dummy-brawl/.env'
   ```

   The export token is ours to pick — `python -c "import secrets; print(secrets.token_urlsafe(32))"`
   and keep the output. Neither value belongs anywhere in this repo.

3. **Install the three files**, root-owned so a deploy cannot replace them:

   ```sh
   scp server/Dockerfile server/docker-compose.yml blightbloom:/tmp/
   scp server/ci-deploy.sh blightbloom:/tmp/
   ssh blightbloom 'sudo install -o root -g root -m 644 /tmp/Dockerfile /tmp/docker-compose.yml /home/deploy/dummy-brawl/ &&
     sudo install -o root -g root -m 755 /tmp/ci-deploy.sh /home/deploy/dummy-brawl-ci-deploy.sh &&
     rm -f /tmp/Dockerfile /tmp/docker-compose.yml /tmp/ci-deploy.sh'
   ```

   Note the script lives *outside* `/home/deploy/dummy-brawl`: the deploy writes into that directory,
   so the thing deciding what a deploy may do must not be in it.

4. **Register the deploy key** in `/home/deploy/.ssh/authorized_keys`, forced to this one command:

   ```
   command="/home/deploy/dummy-brawl-ci-deploy.sh",restrict ssh-ed25519 AAAA... dummy-brawl-ci
   ```

   The pair is `D:\cloud\dummy_brawl_ci_ed25519`, beside Potion Siege's and fight's. Its private
   half goes into the repository secret below and nowhere else; `restrict` turns off the pty, the
   forwarding and everything but the one command.

## Deploying

```sh
tar czf - -C server main.ts index.ts limits.ts wire.ts | ssh -i <deploy key> deploy@62.238.1.182
```

The forced command is the only thing that key can run: it unpacks those four files and nothing else,
checks the hashes and the `.env`, and restarts the containers — or exits 0 saying "unchanged" when the
files are already there and all three containers are up. CI does the same thing in
`.github/workflows/ci.yml`'s `deploy-collector` job, which stays switched off — and CI green —
until the repository has all three of `COLLECTOR_DEPLOY_KEY` (secret, the private half of the key
registered above), `COLLECTOR_SSH_KNOWN_HOSTS` (variable, the box's pinned host key line, so the
key and the payload go to this box or nowhere) and `COLLECTOR_DEPLOY_ENABLED = true`.

## Reading the data back

```sh
curl -s https://dx.gamestao.com/days -H "authorization: Bearer $DX_EXPORT_TOKEN"
curl -s "https://dx.gamestao.com/export?day=2026-11-25" -H "authorization: Bearer $DX_EXPORT_TOKEN" > day.ndjson
```

One line per batch; a session's batches are joined on `sid`, a player's on `uid`. That is what the
`data-check` skill's per-player reading needs — twenty players a version, read in order — and it is
the reason this is a file and not a database.

## Backups and retention

`dx-backup` gzips the day before's file into `./backups` at 03:20 UTC and deletes the copies older
than `DX_BACKUP_DAYS` (30). The live files are kept 430 days: `KEEP_DAYS` in `index.ts`, checked on
the first batch of each UTC day, so there is no cron. Nothing is promised to anyone yet — the game has
no privacy page — but a portal will ask for one, and a retention already kept is easier to write down
than one we have to start keeping.

A day's file stops growing at 512 MB (`MAX_FILE`) and `POST /c` then answers 507: a flood cannot fill
a disk three other games are on. `/health` answers 503 below 256 MB free, which is what the
healthcheck is there to catch.
