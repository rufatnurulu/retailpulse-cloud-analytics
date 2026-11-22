
# RetailPulse — Cloud Retail Analytics Platform

A cloud-based retail sales analytics platform using
Google Firebase, Python, SQL, and JavaScript.

## Project Goals
- Store retail data in Google Cloud Firestore
- Build an interactive sales analytics dashboard
- Analyze sales trends using Python and SQL
- Implement Firebase Authentication
- Demonstrate cloud database security and operations
- Track development with Git and GitHub

## Tech Stack
- Google Firebase
- HTML, CSS, JavaScript
- Python and Pandas
- DuckDB SQL
- Chart.js
- Git and GitHub

## Status
Under Development

## Firebase access

Each Firebase Authentication UID needs a Firestore document at `users/{uid}`
with an `active` boolean and a `role` string. Manage profiles through Firebase
Console or the Admin SDK. The web app can read the signed-in user's own profile.

| Role | Products | Orders and analytics | Customer directory | Create orders | Adjust stock | CSV button |
| --- | --- | --- | --- | --- | --- | --- |
| Admin | Read | Read | Read | Yes | Yes | Yes |
| Sales | Read | Read | Read | Yes | — | — |
| Inventory | Read | — | — | — | Yes | — |
| Analyst | Read | Read | — | — | — | Yes |

Analysts can see customer IDs in orders for reporting. The customer directory
is restricted to admin and sales. Anyone who can read orders can retrieve that
data through Firestore. The CSV button is a dashboard convenience.

Inventory users and admins can adjust stock independently, including for older
products without stock. Adjustments use a transaction and can only change the
stock field. Profile writes, business data deletion, and order edits are denied
to web clients.

Order creation and stock deduction commit together. New orders store product
and customer document references, a server timestamp, and the current UTC order
date. Firestore verifies the references, price, rounded total, quantity, and
stock deduction. Older products can use a numeric `unit_price` when `price` is
absent or null. Existing orders remain readable under the role permissions above.

Analytics defaults to the latest year available in the orders. The selected year,
month, and category apply to the KPIs, charts, and CSV export.

### Coordinated Firebase Hosting release

Build the reviewed frontend with the target project's Firebase web configuration
and run the frontend and Firestore emulator tests before approval. For a hosted rehearsal, use
a separate staging Firebase project and build the frontend with that project's
configuration. A Hosting preview URL uses the backend selected by the build.

Before approving publication, compare the reviewed `firestore.rules` with the
unpublished Firebase Console draft. Bring the draft up to the reviewed version,
including the role restrictions and order validation. Provision approved user
profiles and verify the matching frontend and rules together in staging. Older
frontend sessions must reload before placing orders after the rollout.

After approval, confirm the production project and its default Hosting site.
In one release window, use the same reviewed checkout for the compiled frontend
and rules. Keep order entry paused while the release propagates, then reload old
tabs and check role access before resuming. For the confirmed default site:

```sh
npm ci
npm run build
firebase deploy --only hosting,firestore:rules --project APPROVED_PRODUCTION_PROJECT_ID
```

Run `npm test` with the Firebase CLI and Java 21+ on PATH. Tests use the local
`demo-retailpulse` emulator project. Use Node.js 24.12 or newer.
