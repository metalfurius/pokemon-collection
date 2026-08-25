# Pocketdex

Pocketdex is a mobile-first, installable TypeScript PWA for one owner’s collection. The current foundation is intentionally neutral: it contains synthetic preview data only and no workbook, personal identifiers, private media, or credentials.

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

The daily path is `Collection`, `Wants`, `Añadir`, and `Ajustes`. New products enter through a pasted/shared HTTPS Cardmarket non-single URL and an explicit `Lo quiero` or `Ya lo tengo` choice. See [`docs/cardmarket-index.md`](docs/cardmarket-index.md) for the bounded, offline-derived identity index contract.

## Canonical web deployment

GitHub Pages is the only canonical frontend publication path. The protected `main` workflow builds a neutral `dist` artifact with `VITE_BASE_PATH=/pokemon-collection/`, binds `revision.json` and the service-worker cache to the commit being deployed, verifies the artifact, and publishes it through the `github-pages` environment.

For a local Pages-shaped artifact:

```sh
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run build
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run check:pages-artifact
```

Firebase remains the private data boundary and rules-only operations use `npx firebase deploy --only firestore:rules`. The historical Firebase Hosting configuration is retained only as a reversible rollback reference; it is not a canonical frontend route and routine rules work must never include `hosting`.

## Boundary

- Catalog identity is modeled separately from holdings, wants, acquisitions, notes, and immutable price observations.
- Workbook files are read into browser memory for preview. The importer hashes the input before and after, reports every row decision, and only mutates local state after explicit confirmation.
- Local state is a versioned backup envelope. Clearing local device data is explicit, and the forward-migration contract is documented in `docs/forward-migrations.md`.
- Synthetic sealed/non-single updates use a versioned, exact-record proposed-change-set workflow with before/after diff, owner confirmation, stale/replay protection, audit history, and safe undo. See `docs/change-sets.md`.
- Firestore rules are deny-by-default. Only exact UID equality can access owner-scoped private documents; no Firebase project ID or credential is committed.
- Firebase Auth, Firestore, exact-owner rules, and trusted-device state are not moved by the Pages deployment. No owner-specific state is bundled into the public-neutral artifact.

## Synthetic fixture

The UI’s starter records and workbook preview use fabricated names and values from `src/fixtures/synthetic.ts`. Real workbooks must never be copied into the repository, logs, screenshots, fixtures, or issue comments.
