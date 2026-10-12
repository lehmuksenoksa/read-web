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

## Security and privacy
- No secrets in the code or the build: Dropbox's browser sign-in (PKCE) is made for public code.
  The Dropbox app key is public by design and comes from a repository variable at build time.
- No third parties: no analytics, no fonts or scripts from other sites. The page's Content
  Security Policy allows connections to Dropbox only.
- Writes only a book's sync file in `/Apps/Read/Sync/`; never anything in `/Books/` or elsewhere
  (`src/paths.ts`, checked by `test/paths.test.ts`).
- The sign-in lasts until the tab or browser is closed; Sign out revokes it at Dropbox.
- Books are read into the page's memory, never stored by the browser (`cache: no-store`).
- Book pages can't run their own scripts: scripts and script attributes are removed before a page
  is shown.

## Development
```
npm ci
npm test
npm run build
```

Built with TypeScript, Vite and Readium's TypeScript toolkit (`@readium/navigator`), tested with
Vitest. Fonts: Figtree and Literata (SIL Open Font License, `public/licences/`).
