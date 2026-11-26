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
wants; here it is only the first frame of the portrait trailer, cut down to 2:3.

## Texts

`store/en/` -- the same four fields Playgama takes: `name.txt`, `short_description.txt`,
`description.txt`, `controls.txt`. English only: CrazyGames takes one listing.

## Preview videos

`store/video/`, built by `npm run build:crazygames && node scripts/make_trailer.mjs` (about four
minutes, needs Chrome and ffmpeg). Both are 18 s, silent, h264, under 10 MB.

**`store/video/` is not tracked** -- 16 MB a pair of derived files that four minutes of Chrome and
ffmpeg make again. Render them when you need them. The pair that went to CrazyGames on 26.11.2026
is in commit `18ba78f`, the last one before the directory was gitignored.

| CrazyGames | File |
|---|---|
| landscape 16:9, 1080p | `trailer_1920x1080.mp4` |
| portrait 2:3, 1080 wide | `trailer_1080x1620.mp4` |

Their rules: 15-20 seconds, no sound, no fast-forwarding, opening on the static cover frame, 50 MB at
most. So each one is one second of the cover, then three shots of the bot riding -- the first race of
all, then a season on with a better ride, then the last division after dark.

`scripts/capture_trailer.mjs` records one shot. It serves `dist-cg` to a headless Chrome and, before
any of the game's code runs, replaces `requestAnimationFrame` and `performance.now` with a clock it
advances itself in fixed 1/60 s beats, taking a screenshot every other beat. Every frame of the video
is then exactly 1/30 s of game time however long the machine took to draw it, so nothing stutters and
nothing is sped up. The same shim writes the save that decides which division and which ride the shot
has, and answers our own collector itself -- a recording is not a player.

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

## Submitted

Sent for review on 26.11.2026 -- game id 186303, build `0dff5d31`, Basic, awaiting review.

- **1 Upload**: `dist-cg/`, 35 files, orientation locked to BOTH at build time.
- **2 QA**: all six requirement rows answered Yes, except the Terms & Conditions / Privacy Policy
  row, answered N/A on the grounds in the section above. That row is the one judgement call here.
- **3 Details**: category Driving (they have no Racing); tags 3D, Physics, Fighting, Stunt, 1 Player;
  the texts from `store/en/`; the three covers; both trailers; tools: Claude.
- **4 Submit**: the Developer Portal's Terms & Conditions and PEGI 12, both agreed to.
