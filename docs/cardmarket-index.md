# Cardmarket identity index

Pocketdex resolves links against a small, versioned identity index. The browser never requests a product page, follows a redirect, scrapes markup, uses marketplace credentials, or sends a pasted URL to a backend.

The checked-in release index is derived from Cardmarket’s public Pokémon non-single product catalog. Rebuild its deterministic TypeScript module from an approved, non-secret source with:

```sh
node scripts/build-cardmarket-index.mjs <products_nonsingles_6.json> <src/data/cardmarket-index.generated.ts>
```

The builder accepts only the published Pokémon Display and Pokémon Tins categories, enforces at most 5,000 identities and 2 MB, requires a numeric `idProduct`, preserves packaging variants as separate identities, and records the source timestamp and SHA-256 in the generated module. Production loads that validated static index; synthetic identities are limited to tests and explicit demo journeys.

Each index keeps `createdAt`. A fresh index is preferred, an old one is labelled stale, and an unusable current index falls back to the complete `lastKnownGood` snapshot. If neither snapshot has a match, the UI reports zero candidates and does not invent a product.

Resolution order is deterministic:

1. Exact `idProduct` from a valid HTTPS Cardmarket product URL.
2. Normalized locale-independent category and pretty slug.
3. Conservative unique name/type matching for imported roadmap items when the official identity is unambiguous.
4. Explicit zero, one, or multiple candidates; multiple variants always require a user choice or a Cardmarket search link.

Tracking parameters are ignored for identity. The canonical source URL is retained in the local record for review, while holdings, Wants, notes, and backups remain owner-local.
