# Zero-cost static deployment

The repository is configured for Firebase Hosting plus Firestore rules. Hosting serves only the compiled neutral shell from `dist`; owner-specific state is not bundled into the static artifact.

The deployment boundary is intentionally limited to the Firebase Spark/free tier:

- Firebase Hosting for the static PWA;
- Firestore for exact-owner private state and public-neutral catalog identity;
- no managed file storage service, server-side functions, server credentials, or paid billing dependency.

## Owner-run deployment

Use an approved Firebase project outside the repository. Do not commit `.firebaserc`, real owner UIDs, `.env` files, or credentials.

```sh
npm ci
npm run check
npm run build
npx firebase-tools login
npx firebase-tools use <approved-project-id>
npx firebase-tools deploy --only hosting,firestore:rules
```

After deployment, record the canonical Hosting URL, deployed revision, rules revision, and a no-query document/asset check in the protected review. Do not call a deployment complete until the synthetic collection journey, offline reload, exact-owner boundary, and privacy checks have been exercised in desktop and mobile browsers.
