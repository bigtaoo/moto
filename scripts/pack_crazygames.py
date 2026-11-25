"""Lay out the build for CrazyGames, which hosts the files itself.

usage: python scripts/pack_crazygames.py [dist dir] [out dir]

Two things make this different from scripts/pack_playgama.py:

- No Playgama Bridge. index.html pulls it from Playgama's CDN, and it has no business running on a
  rival portal: it would send those players' analytics to Playgama, and CrazyGames' first technical
  requirement is that the game loads with no errors. src/platform.ts was written to run without it
  (saves fall back to localStorage, no ads), which is also what the submission form declares.
- No archive. The portal rejects zips ("Archive files are not supported"): the files go up through
  its folder picker, so this writes a plain directory and `playgama-bridge-config.json` is left out.

A Basic launch wants no SDK at all -- and gets no ads. A Full launch would mean the CrazyGames SDK
instead, which is a change to src/platform.ts, not to this script.
"""
import os
import re
import shutil
import sys

BRIDGE = re.compile(r'^.*playgama-bridge\.js.*\n', re.M)


def check_telemetry(src):
    """
    The collector's address must be in the built JS. Swarm Orbit shipped four packages that sent
    nothing at all because the variable was set in CI and the packing ran on a desktop; it was only
    found days later, by grepping the zips. The address lives in .env.production now, so this only
    fails when someone moves it -- and then it fails here, before a package exists to upload.
    """
    line = ""
    env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.production")
    if os.path.isfile(env):
        with open(env, encoding="utf-8") as f:
            for raw in f:
                if raw.startswith("VITE_TELEMETRY="):
                    line = raw.split("=", 1)[1].strip()
    if not line:
        sys.exit("no VITE_TELEMETRY in .env.production: the build would collect nothing")
    for root, _, files in os.walk(src):
        for f in files:
            if f.endswith(".js"):
                with open(os.path.join(root, f), encoding="utf-8", errors="ignore") as fh:
                    if line in fh.read():
                        return
    sys.exit(f"{line} is in no built script under {src}/: rebuild, the package would collect nothing")


def pack(src, out):
    if not os.path.isfile(os.path.join(src, 'index.html')):
        sys.exit(f'{src}/index.html missing: run the build first')
    check_telemetry(src)
    if os.path.isdir(out):
        shutil.rmtree(out)
    shutil.copytree(src, out)
    # Only a Playgama build drops this file beside the page; a dist built without it still makes a
    # perfectly good CrazyGames package, so its absence is nothing to stop the packer over.
    cfg = os.path.join(out, 'playgama-bridge-config.json')
    if os.path.isfile(cfg):
        os.remove(cfg)
    page = os.path.join(out, 'index.html')
    with open(page, encoding='utf-8') as f:
        html = f.read()
    html, n = BRIDGE.subn('', html)
    if n != 1:
        sys.exit(f'expected one Bridge script tag in index.html, found {n}')
    with open(page, 'w', encoding='utf-8') as f:
        f.write(html)
    files = [os.path.join(r, f) for r, _, fs in os.walk(out) for f in fs]
    size = sum(os.path.getsize(f) for f in files)
    print(f'{out}/: {len(files)} files, {size / 2**20:.1f} MB. Upload the folder itself in the portal.')


if __name__ == '__main__':
    pack(sys.argv[1] if len(sys.argv) > 1 else 'dist', sys.argv[2] if len(sys.argv) > 2 else 'dist-cg')
