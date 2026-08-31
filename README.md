# Pocketdex

Pocketdex is a mobile-first, installable TypeScript PWA for one owner’s sealed Pokémon collection. It turns boxes, tins, and displays into a night-time expedition atlas while keeping the collection, goals, notes, audit history, and optional product photos on the current device.

## Local development

```sh
npm ci
npm run dev
```

Quality gates:

```sh
npm run check
```

`check` runs strict TypeScript checking, unit tests with coverage thresholds, the dependency audit, the privacy policy scan, and a production build.

The daily path is `Mapa`, `Vitrina`, `Misiones`, and `Registrar`; `Base` holds import, backup, and maintenance tools. The map mounts one active chapter at a time and opens each product in a single reusable mission sheet. Each roadmap item tracks independent `Guardar` and `Abrir` targets and holdings; urgency, language, progress, price ceiling, and Cardmarket identity remain separate fields. New products enter through a pasted/shared HTTPS Cardmarket non-single URL, where goals and current sealed/opened quantities can be recorded together. See [`docs/cardmarket-index.md`](docs/cardmarket-index.md) for the bounded, offline-derived identity index contract.

Product images are optional and local-first. An owner can add a JPEG, PNG, or WebP to one mission, import a filename-matched ZIP pack, or later ship a repository-owned packshot whose manifest records an HTTPS source, licence, and attribution. Pocketdex normalizes owner images to bounded WebP files in IndexedDB; it never scrapes or hotlinks Google Images, Pokémon, or Cardmarket. See [`docs/product-media.md`](docs/product-media.md).

## Canonical web deployment

GitHub Pages is the only canonical frontend publication path. The protected `main` workflow builds a neutral `dist` artifact with `VITE_BASE_PATH=/pokemon-collection/`, binds `revision.json` and the service-worker cache to the commit being deployed, verifies the artifact, and publishes it through the `github-pages` environment.

For a local Pages-shaped artifact:

```sh
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run build
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run check:pages-artifact
```

Firebase remains the private data boundary and rules-only operations use `npx firebase-tools deploy --only firestore:rules`. The historical Firebase Hosting configuration is retained only as a reversible rollback reference; it is not a canonical frontend route and routine rules work must never include `hosting`.

## Boundary

- Catalog identity is modeled separately from holdings, wants, acquisitions, notes, and immutable price observations.
- Workbook files are read into browser memory for preview. The importer understands the Spanish `CAJAS_MASTER` and `TINS_MASTER` roadmap sheets, including headers below introductory rows. It hashes the input before and after, reports every row decision, and only mutates local state after explicit confirmation.
- Local state is a versioned backup envelope. A lightweight JSON backup excludes photos; a full ZIP contains the same backup plus a validated media manifest and WebP assets. Clearing local device data explicitly removes both local state and IndexedDB media. The forward-migration contract is documented in `docs/forward-migrations.md`.
- Synthetic sealed/non-single updates use a versioned, exact-record proposed-change-set workflow with before/after diff, owner confirmation, stale/replay protection, audit history, and safe undo. See `docs/change-sets.md`.
- Firestore rules are deny-by-default. Only exact UID equality can access owner-scoped private documents; no Firebase project ID or credential is committed.
- Firebase Auth, Firestore, exact-owner rules, and trusted-device state are not moved by the Pages deployment. No owner-specific state is bundled into the public-neutral artifact.

## Private data and demo fixture

The normal application starts from the device’s saved state or an empty roadmap. Fabricated records from `src/fixtures/synthetic.ts` are available only for explicit development/demo journeys. Real workbooks, generated private backups, personal identifiers, owner-uploaded media, and credentials must never be copied into the repository, logs, fixtures, issue comments, or visual test artifacts.
