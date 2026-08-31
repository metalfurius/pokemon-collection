# Privacy boundary

The public-neutral shell may contain UI source and non-personal catalog identity. Owner-specific state must remain private:

- holdings and quantities;
- opened/owned status, condition, language, and grading details;
- wants and priorities;
- acquisition details and notes;
- immutable price observations;
- owner-uploaded product photos and their original filenames;
- local backup files and exact owner identifiers.

The browser importer is local-only and preview-first. It never uploads or modifies the selected workbook. The repository contains only synthetic fixtures. Do not add real workbook data to tests, screenshots, logs, pull requests, or deployment artifacts.

The Firestore design uses `owners/{exactUid}/private/...` for owner-specific documents and denies all other paths by default. The client-side local demo is not an authentication mechanism; production private state must be accessed only through the exact-owner Firebase adapter and the matching rules.

Proposed change sets and their audit history are owner-scoped private data. The local review surface uses only a fabricated `synthetic-owner` context, never a real UID or credential. Change-set evidence and fixtures must remain synthetic or public-neutral snapshots; no marketplace HTML, account data, or private media is fetched or stored.

Owner product photos are decoded and resized in the browser, stripped of source metadata by canvas re-encoding, and stored as bounded WebP blobs in IndexedDB. They are not written into localStorage, sent to Firebase, fetched by a service worker from a third party, or included in a JSON-only backup. A full ZIP backup contains them only because the owner explicitly exports it. Device clearing waits for IndexedDB media deletion before clearing the collection and journal.

Bundled product media is a different, public-neutral path. Every file must be repository-owned and have a manifest entry with an HTTPS source, licence, and attribution. Search-result appearance, marketplace display, or personal noncommercial access is not evidence of redistribution permission. Pocketdex therefore does not scrape or hotlink Google Images, Pokémon, Cardmarket, or seller photos.
