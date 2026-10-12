# Read on the web

The Read app's books in a browser: sign in with Dropbox, open a book at your place, read, and the
place goes back to the phones through the same sync files they use.

**Page:** https://lehmuksenoksa.github.io/read-web/

## What it does and doesn't do
- Lists the EPUBs in Dropbox's `/Books/`, with the titles, authors, series and covers the phones
  put in `/Apps/Read/Sync/library.json`.
- Opens a book at this browser's place (device "Web" in the sync files); asks when another device
  is further on; a book never read here opens at the furthest place.
- Turns pages with the arrow keys, Page Up/Down, Space, a click on either side, or a swipe.
- Saves the place a few seconds after the last page turn, to the book's own sync file only.
- Quiet for an office: a plain list (series grouped, a progress line per row), the system font,
  the look's colours on the whole page, no titles on the reader page or in the browser tab.
- **Aa**: Web's own looks (Text, Layout with 1 or 2 columns, Colour, Looks), kept in Dropbox in
  `/Apps/Read/Sync/devices/Web/setup.json`; Bookerly and fonts downloaded from Google Fonts, both
  in `/Apps/Read/Fonts/`, read into memory. **Contents** goes to a chapter.

## Security and privacy
- No secrets in the code or the build: Dropbox's browser sign-in (PKCE) is made for public code.
  The Dropbox app key is public by design and comes from a repository variable at build time.
- No third parties: no analytics, no scripts from other sites. The page's Content Security Policy
  allows connections to Dropbox, and to Google Fonts for a font's Download only (the font then
  lives in Dropbox and is read from there).
- Writes only a book's sync file in `/Apps/Read/Sync/`, Web's own setup file, and new font files
  in `/Apps/Read/Fonts/` (never overwriting); never anything in `/Books/` or elsewhere
  (`src/paths.ts`, checked by `test/paths.test.ts`).
- The sign-in lasts until the tab or browser is closed; Sign out revokes it at Dropbox.
- Books, covers and fonts are read into the page's memory, never stored by the browser
  (`cache: no-store`). The browser itself keeps nothing.
- Book pages can't run their own scripts: scripts and script attributes are removed before a page
  is shown.

## Development
```
npm ci
npm test
npm run build
```

Built with TypeScript, Vite and Readium's TypeScript toolkit (`@readium/navigator`), tested with
Vitest. Font: Literata, for books whose look font isn't available (SIL Open Font License, `public/licences/`).
