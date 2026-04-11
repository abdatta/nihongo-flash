# AGENTS.md

## Project Snapshot

`nihongo-flash` is a small TypeScript React flashcard app for practicing Japanese reading and writing.

Current stack:

- Vite 7
- React 18
- TypeScript with strict type-checking
- Tailwind CSS 3
- `lucide-react`
- Hand-written service worker and web manifest
- GitHub Pages deployment via GitHub Actions

There is no backend, no server state, no external API, and no formal test suite.

## Repo Layout

- `src/App.tsx`: almost all application logic and UI
- `src/types.ts`: shared app types, especially cards and stats
- `src/main.tsx`: app bootstrap and service worker registration
- `src/pages/`: thin page wrappers for read, write, stats, and settings
- `src/index.css`: Tailwind imports and minimal global styles
- `public/sw.js`: service worker
- `public/manifest.webmanifest`: PWA manifest
- `public/icons/`: app icons
- `index.html`: HTML shell
- `vite.config.js`: Vite config with GitHub Pages base-path handling and app version injection
- `.github/workflows/deploy.yml`: Pages build and deploy workflow

## Architecture Notes

### Navigation

The app is a single-page shell with four hash-based pages:

- `#/` or `#/read`: reading practice
- `#/write`: writing practice
- `#/stats`: stats view
- `#/settings`: settings

Page selection is derived from `window.location.hash` in `useActivePage`. There is no router dependency.

### Main card model

Cards use this shape:

```ts
{
  id: string
  char: string
  romaji: string
  type: 'hiragana' | 'katakana' | 'kanji'
  readingType?: 'onyomi' | 'kunyomi'
  readingRange?: [number, number]
}
```

For kanji cards, `readingType` and `readingRange` belong on the card item itself.

- `readingRange` is `[start, end)` within `romaji`
- use `readingRange` only when the kanji reading is part of a longer displayed romaji string

Built-in data lives in `HIRAGANA`, `KATAKANA`, `JLPT_N5_KANJI`, and `DEFAULT_WORDS` in `src/App.tsx`.

`customItems` starts empty by default and only contains user-added character items.

### Practice flow

`PracticeSession` builds a 15-card session from `buildAdaptiveQueue`.

The queue is no longer a simple random shuffle. It prioritizes:

- due cards
- weaker cards
- low-review cards
- a limited number of new cards

This queue uses spaced-repetition style fields such as `reviews`, `ease`, `intervalDays`, `lastReviewedAt`, and `dueAt`.

### Stats model

Stats are stored per card and per direction (`k2r`, `r2k`) using `DirectionStats` from `src/types.ts`.

Important fields:

- `gotIt`, `missed`: legacy lifetime counters still present during migration
- `streak`
- `reviews`
- `recentResults`: last 10 outcomes stored as `1` and `0`
- `ease`, `intervalDays`, `lastReviewedAt`, `dueAt`

### Strength classification and migration

Strength labels are computed, not stored.

Current behavior:

- classification is based on recent results once `recentResults.length >= 5`
- before that threshold, the app falls back to legacy lifetime accuracy for that card
- once a card crosses the threshold, all accuracy-based logic for that card uses recent results, including queue priority and stats display
- the stats page shows a green dot when recent-window logic is active and a red dot when the card is still on fallback logic

Do not store UI labels in persisted stats. Persist stable data only.

## Persistence

Persisted to `localStorage`:

- `stats`
- `settings`
- `customItems`
- `wordItems`
- sound enabled
- haptics enabled

Not currently persisted:

- no known user-facing settings or deck edits in the current flow

Do not assume refresh-safe persistence exists for all settings.

## Writing Mode

`DrawingPad` is a freehand practice surface only.

- no handwriting recognition
- no automatic grading
- grading remains manual through `Got it` / `Missed`

## UI And Styling

- Tailwind utilities are the default styling approach
- keep global CSS minimal
- preserve the mobile-first app-shell layout
- preserve bottom navigation and safe-area behavior
- keep the existing dark zinc + emerald visual language unless a redesign is explicitly requested

When making UI changes, favor small local edits over introducing new abstractions unless they clearly improve maintainability.

## TypeScript Guidance

- Prefer shared types from `src/types.ts` over inline ad hoc object shapes
- Keep persisted data and derived/computed UI state separate
- If you add or change stats fields, update both normalization and any localStorage migration logic
- Avoid bypassing type safety with `any` unless there is a strong reason and it is contained

## Japanese Text / Encoding

The Japanese source data was verified to be valid UTF-8 in `src/App.tsx`.

Important nuance:

- some terminal or shell output in this environment may display Japanese text incorrectly
- the source file itself is not currently known to be corrupted

So:

- do not assume mojibake in terminal output means the file is broken
- when editing Japanese text, still use UTF-8-safe tools and verify in the browser if needed

## PWA And Deployment

### Base path

GitHub Pages base-path handling is intentional.

- `vite.config.js` computes `base` from `GITHUB_REPOSITORY` during GitHub Actions builds
- `src/main.tsx` registers the service worker from `${import.meta.env.BASE_URL}sw.js`
- `index.html` uses `%BASE_URL%` for the manifest and Apple touch icon

Do not casually replace these with root-relative paths.

### Service worker

`public/sw.js` uses cache versioning via the `v` query param and cache-first behavior for app-shell assets.

If you change caching or app-shell assets:

- review `CACHE_NAME`
- review `APP_SHELL`
- verify GitHub Pages behavior carefully, since stale caches can mislead local testing

### CI / deploy

The GitHub Actions workflow:

- installs dependencies with `npm install`
- runs `npm run build`
- deploys `dist` to GitHub Pages

Because `npm run build` now runs `tsc --noEmit && vite build`, CI also performs TypeScript validation.

If you change build commands, output paths, or base-path behavior, review `.github/workflows/deploy.yml`.

## Validation

Primary validation commands:

```bash
npm install
npm run typecheck
npm run build
npm run dev
```

Notes:

- there is no formal test suite right now
- there is no lint script right now
- `npm run build` is the main required verification step for code changes

## Change Guidance

Before non-trivial edits:

1. Read `src/App.tsx`, `src/types.ts`, and `src/main.tsx`
2. Check whether the change affects service worker behavior or GitHub Pages base paths
3. Check whether the change touches persisted stats or localStorage normalization

When changing behavior:

- keep dependencies light
- avoid introducing routing, state libraries, or backend assumptions unless requested
- prefer targeted changes over architectural rewrites
- keep components local unless extracting them clearly reduces complexity

## Common Tasks

### Adding or changing study items

- edit the built-in study data in `src/studyData.json`
- preserve stable unique `id` values
- keep `romaji` lowercase
- verify Japanese text with a UTF-8-safe editor and, if needed, in the browser rather than trusting shell output

#### Card ID guidance

- treat `id` as a stable persistence key, not as display data
- do not derive new `id` values from `romaji` alone for kanji or words
- kana IDs like `h_ki` and `k_ki` are fine because the script namespace disambiguates them
- for kanji and words, prefer disambiguated IDs that include meaning or another stable qualifier
- examples: `n5_ki_tree`, `n5_ki_spirit`, `w_hashi_bridge`, `w_hashi_chopsticks`
- avoid changing existing built-in IDs casually, since stats and saved progress are keyed by `id`

### Changing practice or scheduling behavior

Check these together:

- `buildAdaptiveQueue`
- `PracticeSession`
- `Flashcard`
- `calculateNextDirectionStats`
- `getCardPriority`
- `getCardStrengthMeta`

### Changing stats or migrations

Check these together:

- `DirectionStats` in `src/types.ts`
- `normalizeStats`
- localStorage load/save behavior
- effective accuracy helpers
- stats page dot/status behavior

### Changing settings or deck management

Check these together:

- `SettingsView`
- `settings` state in `App`
- `customItems` state in `App`
- `activePool` derivation

### Changing deployment or offline behavior

Check these together:

- `vite.config.js`
- `index.html`
- `src/main.tsx`
- `public/sw.js`
- `.github/workflows/deploy.yml`

## What Not To Assume

- Do not assume all state is persisted
- Do not assume handwriting recognition exists
- Do not assume random shuffle is still the session strategy
- Do not assume stats labels are stored directly
- Do not assume terminal mojibake means the source file is corrupted
- Do not assume root-relative asset paths are safe for GitHub Pages
