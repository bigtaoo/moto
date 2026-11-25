#!/bin/sh
# The only command the deploy key may run on blightbloom: it reads a tar.gz from stdin, takes the
# collector's files (FILES) out of it -- nothing else, whatever else the archive holds -- puts them in
# /home/deploy/dummy-brawl and restarts the containers. `.github/workflows/ci.yml`'s deploy-collector
# job sends it; server/README.md says how this script is installed.
#
# The key is registered in /home/deploy/.ssh/authorized_keys as
#   command="/home/deploy/dummy-brawl-ci-deploy.sh",restrict ssh-ed25519 AAAA... dummy-brawl-ci
# so sshd runs this script whatever the key's holder asks for, as `deploy` (never root), with no pty
# and no forwarding. The live copy sits outside the deploy target, so a deploy can never replace it;
# editing this file changes nothing on the box until it is installed again. `.env` holds the two
# secrets and is never read, written or sent by this script.
#
# The Dockerfile and docker-compose.yml decide what runs and with which mounts, so they never come
# from CI: they are installed by hand (server/README.md) and must hash to the values below, which
# server/deploy.test.ts keeps equal to server/'s copies. Changing either file means installing it and
# this script again, by hand.
set -eu

TARGET="$HOME/dummy-brawl"
DOCKERFILE_SHA256=6ec111f700cf2be417d321adea6e12bf9e3b818fa2b7e65900a52ccb978569a6
COMPOSE_SHA256=26fd9f3adef9dd3498ebf0a835118eb2a65a79722e76fd67f535e1dc5b9f1821
# the collector's own files, in the order CI packs them (the Dockerfile copies the same)
FILES="main.ts index.ts limits.ts wire.ts"
# the collector is ~25 KB of source; anything near this is not it
MAX_PAYLOAD=1048576
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# shellcheck disable=SC2086 # FILES splits into its names on purpose
head -c "$MAX_PAYLOAD" | tar xzf - -C "$STAGE" --no-same-owner --no-same-permissions $FILES ||
  { echo "payload is not a tar.gz with $FILES, aborting" >&2; exit 1; }
for f in $FILES; do
  [ -f "$STAGE/$f" ] && [ ! -L "$STAGE/$f" ] ||
    { echo "payload is missing $f, aborting" >&2; exit 1; }
done

hash_ok() {
  [ "$(sha256sum "$TARGET/$1" 2>/dev/null | cut -d' ' -f1)" = "$2" ] ||
    { echo "$TARGET/$1 is not the one installed by hand (sha256 $2), aborting" >&2; exit 1; }
}
hash_ok Dockerfile "$DOCKERFILE_SHA256"
hash_ok docker-compose.yml "$COMPOSE_SHA256"
for v in DX_TUNNEL_TOKEN DX_EXPORT_TOKEN; do
  grep -q "^$v=..*" "$TARGET/.env" 2>/dev/null ||
    { echo "$v is missing or empty in $TARGET/.env (server/README.md)" >&2; exit 1; }
done
# created here, as deploy, so the bind mounts are not created root-owned by docker
mkdir -p "$TARGET/data" "$TARGET/backups"

up() {
  [ "$(docker inspect -f '{{.State.Health.Status}}' dx-collector 2>/dev/null)" = healthy ] &&
    [ "$(docker inspect -f '{{.State.Status}}' dx-tunnel 2>/dev/null)" = running ] &&
    [ "$(docker inspect -f '{{.State.Status}}' dx-backup 2>/dev/null)" = running ]
}

same() {
  for f in $FILES; do cmp -s "$STAGE/$f" "$TARGET/$f" || return 1; done
}

# Every push to main runs this job; a push that does not change the collector restarts nothing.
if same && up; then
  echo "unchanged, dx-collector healthy, dx-tunnel and dx-backup running"
  exit 0
fi

for f in $FILES; do
  cp "$STAGE/$f" "$TARGET/$f"
  chmod 644 "$TARGET/$f"
done
cd "$TARGET"
docker compose up -d --build --force-recreate
for _ in $(seq 1 30); do
  up && { echo "dx-collector healthy, dx-tunnel and dx-backup running"; exit 0; }
  sleep 2
done
docker logs --tail 30 dx-collector
docker logs --tail 15 dx-tunnel || true
docker logs --tail 15 dx-backup || true
echo "dx-collector, dx-tunnel or dx-backup did not come up" >&2
exit 1
