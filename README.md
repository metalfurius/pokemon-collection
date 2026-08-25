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

## Boundary

- Catalog identity is modeled separately from holdings, wants, acquisitions, notes, and immutable price observations.
- Workbook files are read into browser memory for preview. The importer hashes the input before and after, reports every row decision, and only mutates local state after explicit confirmation.
- Local state is a versioned backup envelope. Clearing local device data is explicit, and the forward-migration contract is documented in `docs/forward-migrations.md`.
- Synthetic sealed/non-single updates use a versioned, exact-record proposed-change-set workflow with before/after diff, owner confirmation, stale/replay protection, audit history, and safe undo. See `docs/change-sets.md`.
- Firestore rules are deny-by-default. Only exact UID equality can access owner-scoped private documents; no Firebase project ID or credential is committed.
- Static hosting is configured through `firebase.json`, but deployment requires an approved project and a later protected-delivery checkpoint.

## Synthetic fixture

The UI’s starter records and workbook preview use fabricated names and values from `src/fixtures/synthetic.ts`. Real workbooks must never be copied into the repository, logs, screenshots, fixtures, or issue comments.
