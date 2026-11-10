# Store listing

Material for the Playgama publication form. Nothing here ships in the game build.

## Texts

`<lang>/` holds one file per field, UTF-8. The languages are the seven the game is translated into: en, ru, es, pt, tr, de, fr.

| File | Field |
|---|---|
| `name.txt` | Title: `Dummy Brawl` in every language, the same as the in-game logo (Playgama 3.5.1) |
| `short_description.txt` | One sentence, under 120 characters |
| `description.txt` | The full description: the hook, five feature lines, the race length |
| `controls.txt` | Touch, keyboard and mouse controls, as the game implements them (`src/view/input.ts`) |

## Covers

`covers/` has the title over a real in-game frame. The title is the only text, with no borders, badges or store logos.

| File | Size | Frame |
|---|---|---|
| `cover_landscape_1920x1080.png` | 16:9 | Frost Pass, a dummy flying off its scooter |
| `cover_square_800x800.png` | 1:1 | The same frame, cut around the action |
| `cover_portrait_1080x1920.png` | 9:16 | Dust Bowl, a KO burst in the pack |
| `cover_portrait_800x1200.png` | 2:3 | The same frame, cut from 300 px down |

`scripts/store_covers.py` (PIL) composes them: `python -I scripts/store_covers.py <shotsDir> store/covers`.
- The title is drawn like the in-game logo: the crash-test badge over "DUMMY BRAWL" in Arial Black, yellow `#f2c230` with an ink `#16161a` outline and drop shadow.
- The background frames came from the dev server at the target size, captured by headless Chrome (playwright-core):
  - Each capture used `?bot&lang=en` with a save preset in `localStorage['dummy-brawl-v1']`, for example `{"races":20,"div":3,"garage":{"cur":3,"owned":[0,3]}}`.
  - The style `#app > :not(canvas){visibility:hidden}` hid the HUD for the clean frames.

## Screenshots

`screenshots/` has nine real frames with the HUD: five landscape at 1920x1080 and four portrait at 1080x1920, one per road. The bot drove each race.
