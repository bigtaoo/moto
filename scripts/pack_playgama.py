"""Zip the build for Playgama's developer console.

usage: python scripts/pack_playgama.py [dist dir] [zip file]

index.html sits at the archive's root, entries are files only (no directory entries) and paths use '/'.
A zip made by PowerShell's Compress-Archive (backslash paths) left the Bridge never initialized on the
portal in another of our games, so the archive is written here instead.
"""
import os
import sys
import zipfile


def pack(src, out):
    for need in ("index.html", "playgama-bridge-config.json"):
        if not os.path.isfile(os.path.join(src, need)):
            sys.exit(f"{src}/{need} missing: run the build first")
    names = []
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            path = os.path.join(root, f)
            names.append((path, os.path.relpath(path, src).replace(os.sep, "/")))
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path, name in names:
            # mp3 is already compressed
            z.write(path, name, zipfile.ZIP_STORED if name.endswith(".mp3") else zipfile.ZIP_DEFLATED)
    with zipfile.ZipFile(out) as z:
        listed = z.namelist()
        assert "index.html" in listed and not any("\\" in n or n.endswith("/") for n in listed)
    print(f"{out}: {len(names)} files from {src}/, {os.path.getsize(out) / 2**20:.1f} MB")


if __name__ == "__main__":
    pack(sys.argv[1] if len(sys.argv) > 1 else "dist", sys.argv[2] if len(sys.argv) > 2 else "dummy-brawl-playgama.zip")
