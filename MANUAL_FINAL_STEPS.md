# RetailPulse final owner steps

## 1. Publish the tested Firestore rules — required for production access restrictions

**Why:** The revised rules enforce the dashboard’s role permissions for direct Firestore reads. They also support the atomic order and stock transaction. The production rules must be published separately from Hosting.

**Prerequisites:** Use the reviewed commit on GitHub `main`. Sign in locally with access to project `retailpulse-cloud-analytics`. In [Firestore Database → Rules](https://console.firebase.google.com/project/retailpulse-cloud-analytics/firestore), save a copy of the currently active rules before deployment. Keep the backup outside Git.

From the repository root, verify the project and publish only Firestore rules:

```sh
firebase login
firebase projects:list
firebase deploy --only firestore:rules --project retailpulse-cloud-analytics
```

**Verify:** Confirm a new active rules release in Firebase Console. Use existing role accounts to check that Admin and Sales can open Orders, Inventory can open stock controls, and Analyst can view analytics without access to the customer directory. Avoid creating orders or changing stock solely for verification on production.

## 2. Publish the frontend — required to show the redesign on the live site

**Why:** Firebase Hosting continues to serve the last deployed frontend until a new release is published.

**Prerequisites:** Use the same reviewed GitHub commit. Configure the Firebase web SDK variables in an ignored `.env.local` as described in the README. Use the existing project and an authenticated Firebase CLI session.

```sh
npm ci
npm run build
firebase deploy --only hosting --project retailpulse-cloud-analytics
```

**Verify:** Open [RetailPulse](https://retailpulse-cloud-analytics.web.app) in a private browser window. Confirm the dark sign-in page, sign in with an existing account, and check the navigation and dashboard. Open [favicon.svg](https://retailpulse-cloud-analytics.web.app/favicon.svg) to verify the new icon assets are accessible.
