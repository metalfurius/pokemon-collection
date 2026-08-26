# Canonical static deployment

GitHub Pages is the only canonical frontend route. The protected `main` workflow in `.github/workflows/deploy-pages.yml` builds and verifies `dist`, then deploys it through the `github-pages` environment. The build always uses `VITE_BASE_PATH=/pokemon-collection/` and binds `revision.json`, the HTML metadata, and the service-worker cache to `VITE_REVISION`, which is the commit being deployed.

The repository owner must enable GitHub Pages with **GitHub Actions** as the publishing source if the Pages settings are still disabled. The workflow intentionally does not carry an administrative token or try to change repository ownership settings.

The Pages deployment boundary is intentionally static and neutral:

- GitHub Pages for the frontend artifact;
- Firebase Auth and Firestore for the existing private data layer;
- no owner-specific records, credentials, private media, or backend service in `dist`.

## Local artifact verification

Use synthetic values only. Do not commit `.firebaserc`, real owner UIDs, `.env` files, or credentials.

```sh
npm ci
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run check
VITE_BASE_PATH=/pokemon-collection/ VITE_REVISION=<commit-sha> npm run check:pages-artifact
```

The artifact gate checks that the no-query document, every referenced asset, manifest, service worker, cache version, and revision metadata belong to one `/pokemon-collection/` release.

## Firebase rules-only operations

Firebase is not the frontend deployment route. For an approved rules change, use the rules-only command below after running the emulator and review gates:

```sh
npx firebase-tools deploy --only firestore:rules
```

Do not append `hosting` and do not use Firebase Hosting to publish the frontend. The historical `hosting` block in `firebase.json` remains reversible rollback material until Pages production verification is complete; any rollback requires an explicit protected review and must not migrate or delete the Firebase project, Auth, Firestore, rules, credentials, users, or data.
