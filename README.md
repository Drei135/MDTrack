# FileVault — Offline-First PWA File Manager

A Google-Drive-style file manager built as an installable, offline-first
Progressive Web App: React (Vite) + Tailwind on the front end, Supabase
(Postgres + Auth + Storage) on the back end, deployed to Netlify.

## 1. Supabase setup

1. Create a new Supabase project.
2. Open the SQL editor and run **`supabase_schema.sql`** in full. This creates:
   - `profiles` (auto-populated on signup via trigger) and `files_folders`
     (self-referencing tree via `parent_id`) with RLS enabled.
   - The `filevault` Storage bucket plus per-user storage policies
     (`{user_id}/...` path isolation).
   - RPCs for cascade soft-delete/restore (`trash_item_cascade`,
     `restore_item_cascade`), permanent purge (`purge_item_cascade`,
     `empty_trash`), folder size aggregation, and share-link management
     (`create_share_link`, `revoke_share_link`).
3. In **Authentication → Providers**, enable Email (and any OAuth providers
   you want — the app calls `signInWithOAuth` generically).
4. Copy your Project URL and anon public key into `.env.local` (see
   `.env.example`).

## 2. Local development

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL/anon key
npm run dev
```

The dev server runs the PWA service worker too (`devOptions.enabled` in
`vite.config.js`), so you can test offline behavior locally: open DevTools →
Application → Service Workers → "Offline", or just disconnect your network.

## 3. Deploying to Netlify

1. Push this repo to GitHub/GitLab/Bitbucket and "Import" it in Netlify, or
   run `netlify deploy --build --prod` from the CLI.
2. `netlify.toml` already sets the build command (`npm run build`), publish
   directory (`dist`), SPA redirect, and cache headers for the service worker.
3. In **Site settings → Environment variables**, add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.

## 4. How the offline layer works

- **`src/lib/offlineDb.js`** wraps a Dexie (IndexedDB) database with two
  tables: `items` (a local mirror of `files_folders` rows you've fetched) and
  `syncQueue` (mutations recorded while offline).
- **`src/lib/fileOps.js`** checks `navigator.onLine` before every write. If
  online, it writes straight to Supabase and updates the local cache. If
  offline, it applies an optimistic update to the local cache immediately and
  pushes a queue entry instead (renames, folder creation, moves, trash,
  restore, star toggles — anything that's just a metadata row change).
  Uploads, copies, and permanent purges of storage objects require
  connectivity and are not queued, since they involve binary data transfer.
- **`attachAutoSync`** listens for the `online` event and replays the queue
  in FIFO order via `syncPendingActions`, stopping at (and preserving) the
  first failure so ordering/integrity is never violated.
- **`vite-plugin-pwa`**'s Workbox config precaches the app shell and uses
  `CacheFirst` for Supabase Storage file bytes (so previously opened files
  reopen offline) and `NetworkFirst` for Supabase REST metadata calls.

## 5. In-app file viewer

`src/components/FileViewerModal.jsx` renders, without forcing a download:

- **Images** — lightbox with wheel-to-zoom, drag-to-pan, and rotate.
- **Video/Audio** — native `<video>`/`<audio>` players with custom framing.
- **PDF** — embedded via `<iframe>` using the browser's built-in PDF renderer
  against a signed Supabase Storage URL.
- **Text/JSON/code** — monospace viewer; **Markdown** — rendered with
  `react-markdown`.
- **Anything else (DOCX, XLSX, PSD, ...)** — an "Open With" fallback screen
  offering Google Docs Viewer, Microsoft Office Web Viewer, or a direct
  download link for a local app/protocol handler.

## 6. Folder-tree uploads

- Dropping a folder onto the app uses the `DataTransferItemList` /
  `webkitGetAsEntry` API (`flattenDataTransferItems`) to recursively walk the
  dropped tree.
- The "Upload folder" toolbar button uses a hidden
  `<input webkitdirectory multiple>` (`flattenFileList`), which yields
  `webkitRelativePath` for the same purpose.
- Both feed into `uploadFileTree`, which recreates the folder hierarchy via
  `createFolder` (memoized per path) before uploading each file into its
  correct new parent.

## 7. Sharing

`create_share_link` mints a UUID token on the row (`share_token`) with an
optional expiry and view/edit permission; the app builds a
`/share/:token` URL. The `files_folders` RLS policy permits anonymous
`SELECT` on rows with a valid, unexpired `share_token`, so a lightweight
public share page (not included here — add a `/share/:token` route that
looks the row up by token and calls `createSignedUrl` for the actual file
bytes) can resolve it without requiring the visitor to sign in.
