# AGENTS.md

## Project Overview

`nihongo-flash` is a small single-page React app for practicing Japanese reading and writing with flashcards.

The stack is intentionally minimal:

- Vite 7 for bundling and local development
- React 18 with a single top-level app component
- Tailwind CSS 3 for styling
- `lucide-react` for icons
- A hand-written service worker and web manifest for basic PWA support
- GitHub Pages deployment via GitHub Actions

There is no backend, no router, no external API, and no formal test suite at the moment. All application state is client-side and currently in memory only.

## Repository Layout

- `src/main.jsx`: app bootstrap, global CSS import, service worker registration
- `src/App.jsx`: nearly all application logic and UI
- `src/index.css`: Tailwind imports plus a few global styles
- `public/manifest.webmanifest`: PWA manifest
- `public/sw.js`: cache-first service worker
- `public/icons/`: PWA icons
- `index.html`: HTML shell and manifest/icon wiring
- `vite.config.js`: React plugin plus GitHub Pages base-path handling
- `.github/workflows/deploy.yml`: build and deploy workflow for GitHub Pages

## How The App Works

### Main data model

`src/App.jsx` defines three built-in datasets near the top of the file:

- `HIRAGANA`
- `KATAKANA`
- `DEFAULT_KANJI`

Each item has this shape:

```js
{
  id: 'unique_id',
  char: 'character_or_word',
  romaji: 'reading',
  type: 'hiragana' | 'katakana' | 'kanji'
}
```

`customItems` is initialized from `DEFAULT_KANJI`, so the so-called "custom" deck currently doubles as the built-in kanji/word list.

### Tabs / views

The app is effectively four views selected by `activeTab` in `App`:

- `k2r`: reading practice (`char -> romaji`)
- `r2k`: writing practice (`romaji -> char`) with a drawing pad
- `stats`: grouped performance summary
- `settings`: category toggles and custom deck editing

There is no URL-based navigation. Switching views is entirely local state driven.

### Session flow

`PracticeSession`:

- receives the active pool and direction
- shuffles the pool
- takes up to 15 cards per session
- advances after the user marks a card as `gotIt` or `missed`

The shuffle is currently `sort(() => 0.5 - Math.random())`, which is simple but not statistically ideal. Preserve behavior unless intentionally improving it.

### Stats model

Stats are stored in-memory in `stats` using this shape:

```js
{
  [cardId]: {
    k2r: { gotIt, missed, streak },
    r2k: { gotIt, missed, streak }
  }
}
```

Important: stats are not persisted to `localStorage`, IndexedDB, or any backend. A page refresh clears progress.

### Writing mode

`DrawingPad` is only a freehand practice surface. It does not evaluate handwriting and is not used for grading. User grading is manual via the `Got it` / `Missed` buttons.

## Styling And UI Conventions

- Styling is almost entirely Tailwind utility classes inline in JSX.
- The visual design is dark-first with zinc neutrals and emerald accents.
- The app is designed like a mobile-first, app-shell experience:
  - fixed-height viewport layout
  - header at the top
  - bottom navigation docked with safe-area padding
- `src/index.css` contains only a small amount of global CSS. Keep global CSS minimal unless a cross-cutting style truly belongs there.

When editing UI, preserve:

- the mobile-friendly layout
- the bottom nav behavior
- safe-area handling via `.pb-safe`
- the existing visual language unless the task explicitly asks for a redesign

## PWA / Deployment Notes

### Base path handling

`vite.config.js` computes `base` from `GITHUB_REPOSITORY` when running in GitHub Actions. This matters for GitHub Pages because assets and service worker registration need the repo subpath.

`src/main.jsx` correctly registers the service worker from:

```js
`${import.meta.env.BASE_URL}sw.js`
```

Do not casually replace this with `/sw.js` or relative paths that ignore the Pages base path.

### HTML shell

`index.html` uses `%BASE_URL%` for the manifest and Apple touch icon links. Keep that pattern intact for Pages compatibility.

### Service worker

`public/sw.js` is a simple cache-first implementation. If you change app-shell assets or caching behavior:

- review `CACHE_NAME`
- update `APP_SHELL` if necessary
- verify fallback behavior still works on GitHub Pages

Be careful: stale service worker caches can make debugging confusing after deploys.

### GitHub Actions

`.github/workflows/deploy.yml`:

- deploys on push to `main`
- installs dependencies with `npm install`
- builds with the GitHub Pages environment variables set
- uploads `dist`
- deploys to Pages

If you change build outputs, paths, or the Vite base behavior, also review this workflow.

## Current Sharp Edges / Known Issues

These are important repo-specific observations an agent should notice before making changes:

### 1. Text encoding looks wrong in `src/App.jsx`

The kana and kanji literals currently appear mojibaked in the checked-in source, for example values like `ã‚` instead of proper Japanese characters. That usually means the file encoding was corrupted or interpreted incorrectly at some point.

Consequences:

- the UI may render broken characters
- editing the file carelessly can preserve or worsen the corruption
- any future content additions should be handled with explicit UTF-8 awareness

If you touch this data, verify the file encoding and test rendered output in the browser.

### 2. State is ephemeral

`settings`, `customItems`, and `stats` all live only in React state. Refreshing the page resets them. Do not assume persistence exists.

### 3. Custom deck naming is slightly misleading

The `kanji` setting controls the built-in `DEFAULT_KANJI` items plus user-added custom items. If you split these concepts later, update both the copy and the state model consistently.

### 4. There are no tests or lint scripts

`package.json` currently exposes only:

- `npm run dev`
- `npm run build`
- `npm run preview`

For validation, `npm run build` is the main automated check available unless you add more tooling.

## Agent Workflow Expectations

Before making non-trivial edits:

1. Read `src/App.jsx`, `src/main.jsx`, and `vite.config.js`.
2. Check whether the change affects the GitHub Pages base path or service worker behavior.
3. Check whether the change touches the encoded Japanese data.

When making changes:

- Prefer small, targeted edits over large rewrites.
- Keep the app dependency-light unless the user explicitly wants new tooling.
- Avoid introducing routing, state libraries, or backend assumptions unless requested.
- Keep components local unless a refactor clearly improves maintainability.

When validating changes:

1. Run `npm run build`.
2. If the change affects PWA behavior, service worker registration, or base URLs, call that out explicitly in your summary because local verification can be misleading.

## Contribution Guidance For Common Tasks

### Adding or changing study items

- Edit the data arrays in `src/App.jsx`.
- Preserve stable unique `id` values.
- Keep `romaji` lowercase because new custom items are normalized to lowercase.
- Be especially careful with file encoding when editing Japanese text.

### Changing practice behavior

Look at:

- `PracticeSession`
- `Flashcard`
- `updateStats`
- `StatsView`

These parts are tightly related, so behavior changes often need coordinated edits.

### Changing settings or deck management

Look at:

- `SettingsView`
- `settings` state in `App`
- `customItems` state in `App`
- `activePool` derivation in `App`

### Changing deployment behavior

Look at:

- `vite.config.js`
- `index.html`
- `src/main.jsx`
- `public/sw.js`
- `.github/workflows/deploy.yml`

## Commands

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## What Not To Assume

- Do not assume there is persistent storage.
- Do not assume handwriting recognition exists.
- Do not assume the app is split into many small components; most logic is centralized in `src/App.jsx`.
- Do not assume asset paths are root-relative; GitHub Pages base-path support is intentional.
- Do not assume adding a new package is harmless in a project this small.

## Preferred Change Style

A good change in this repo is usually:

- small
- easy to review
- mobile-safe
- compatible with GitHub Pages
- careful about service worker caching
- careful about Japanese text encoding

If a task suggests a bigger architecture shift, pause and make sure the extra complexity is really justified by the user request.
