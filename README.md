# Pocketdex

Pocketdex is a mobile-first, installable TypeScript PWA for one owner’s sealed Pokémon collection. It turns boxes, tins, and displays into a visual roadmap while keeping the collection, goals, notes, and audit history on the current device.

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

The daily path is `Mapa`, `Colección`, `Quiero`, and `Añadir`. Each roadmap item tracks independent `Guardar` and `Abrir` targets and holdings; urgency, language, progress, price ceiling, and Cardmarket identity remain separate fields. New products enter through a pasted/shared HTTPS Cardmarket non-single URL, where goals and current sealed/opened quantities can be recorded together. See [`docs/cardmarket-index.md`](docs/cardmarket-index.md) for the bounded, offline-derived identity index contract.

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
- Local state is a versioned backup envelope. Clearing local device data is explicit, and the forward-migration contract is documented in `docs/forward-migrations.md`.
- Synthetic sealed/non-single updates use a versioned, exact-record proposed-change-set workflow with before/after diff, owner confirmation, stale/replay protection, audit history, and safe undo. See `docs/change-sets.md`.
- Firestore rules are deny-by-default. Only exact UID equality can access owner-scoped private documents; no Firebase project ID or credential is committed.
- Firebase Auth, Firestore, exact-owner rules, and trusted-device state are not moved by the Pages deployment. No owner-specific state is bundled into the public-neutral artifact.

## Private data and demo fixture

The normal application starts from the device’s saved state or an empty roadmap. Fabricated records from `src/fixtures/synthetic.ts` are available only for explicit development/demo journeys. Real workbooks, generated private backups, personal identifiers, private media, and credentials must never be copied into the repository, logs, fixtures, or issue comments.
