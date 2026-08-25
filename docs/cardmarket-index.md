# Cardmarket identity index

Pocketdex resolves links against a small, versioned identity index. The browser never requests a product page, follows a redirect, scrapes markup, uses marketplace credentials, or sends a pasted URL to a backend.

The release artifact is derived from a published Pokémon non-single catalog export. Build it from an approved, non-secret source with:

```sh
node scripts/build-cardmarket-index.mjs <published-export.json> <derived-index.json>
```

The builder enforces at most 5,000 identities and 2 MB, rejects single and graded-card object types, requires a numeric `idProduct`, and keeps packaging/language variants as separate identities. The checked-in synthetic index is used only for local/demo journeys; a release may replace it with the validated derived artifact without changing the resolver or UI.

Each index keeps `createdAt`. A fresh index is preferred, an old one is labelled stale, and an unusable current index falls back to the complete `lastKnownGood` snapshot. If neither snapshot has a match, the UI reports zero candidates and does not invent a product.

Resolution order is deterministic:

1. Exact `idProduct` from a valid HTTPS Cardmarket product URL.
2. Normalized locale-independent category and pretty slug.
3. Explicit zero, one, or multiple candidates; multiple variants always require a user choice.

Tracking parameters are ignored for identity. The canonical source URL is retained in the local record for review, while holdings, Wants, notes, and backups remain owner-local.
