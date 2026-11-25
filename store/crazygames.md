# CrazyGames submission

What to upload and what to paste, for the Basic launch. The package itself is `npm run
build:crazygames`; everything else here is already in `store/`. Nothing in this folder ships in the
game build.

## The package

`dist-cg/`, the folder itself -- the portal takes a folder, not a zip. `scripts/pack_crazygames.py`
lays it out from `dist/`: it strips the one Playgama Bridge script tag, drops
`playgama-bridge-config.json`, and refuses to pack at all unless `VITE_TELEMETRY` is actually inside
a built `.js` (the Swarm Orbit lesson -- four packages once shipped collecting nothing).

| CrazyGames asks | We are at |
|---|---|
| 50 MB total without the SDK (20 MB for the mobile homepage) | 1.1 MB |
| 1500 files | 35 |
| relative paths only, never absolute | `./assets/...` in `index.html` |
| loads and plays in desktop Chrome within 20 s, no errors | 0.3 s to `load`, no console errors |
| default language English | `src/i18n/index.ts` falls back to `en` |

## Covers

All three are in `store/covers/` at exactly the sizes CrazyGames asks for. Nothing else is needed:
their docs ask for no logo and no screenshots.

| CrazyGames | File |
|---|---|
| landscape 16:9, 1920x1080 | `cover_landscape_1920x1080.png` |
| portrait 2:3, 800x1200 | `cover_portrait_800x1200.png` |
| square 1:1, 800x800 | `cover_square_800x800.png` |

They are real in-game frames with the title over them and no other text, no borders and no store
logos, which is what their cover rules ask. `cover_portrait_1080x1920.png` is the 9:16 one Playgama
wants and has no use here.

## Texts

`store/en/` -- the same four fields Playgama takes: `name.txt`, `short_description.txt`,
`description.txt`, `controls.txt`. English only: CrazyGames takes one listing.

## Not ready yet

A **preview video**: 15-20 seconds, no sound, no fast-forwarding, opening on the static cover frame,
50 MB at most, and they want both 1080p 16:9 and 1080p 2:3. We have no capture pipeline for this --
the covers were stills from headless Chrome (`store/README.md`), which is not the same job.

## Telemetry, and the thing to decide

This package has no host SDK at all, so `src/platform.ts`'s `bridge.analytics.send` reaches nothing
and the only record of a CrazyGames player is ours: `src/collect.ts` posting to
`https://dx.gamestao.com/c` (`server/`). That was checked end to end against the live collector from
a build of this exact package -- the batches arrive, with the edge country on them.

Two CrazyGames rules touch it, neither of them a ban:

- **Personal data.** "In case your game collects additional personal data beyond the events in our
  SDK, the game should add a Terms & Conditions and/or Privacy Policy notice to new players." What we
  send is a random session id, a random save id, the thirteen common fields and the funnel; the
  server stores no IP address, only the edge country, and there is no free-text field anywhere in the
  wire format (`server/wire.ts`). That is not personal data, but the judgement is the reviewer's.
- **Ads and login must go through their SDK.** We request neither.

## Basic, not Full

Basic is a 7-21 day test: the SDK is optional, monetisation is off and ads are not allowed, which is
exactly this package. Full would mean the CrazyGames SDK with its Gameplay start/stop events -- a
change to `src/platform.ts`, not to `scripts/pack_crazygames.py`.
