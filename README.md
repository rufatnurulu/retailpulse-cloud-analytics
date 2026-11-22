
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

| Role | Dashboard and inventory | Create sale and deduct stock | CSV button |
| --- | --- | --- | --- |
| `admin` | Yes | Yes | Yes |
| `sales` | Yes | Yes | No |
| `inventory` | Yes | No | No |
| `analyst` | Yes | No | Yes |

CSV visibility is a UI feature. All four roles have Firestore read access to
the data backing the dashboard.

Deploy the updated frontend and `firestore.rules` together. The new order
transaction supports both legacy price fields (`price` and `unit_price`),
and adds `product_doc_id` to new orders and `last_order_id` to the updated
product. Existing orders remain readable. The old frontend cannot create sales
under these rules, so refresh open sessions after rollout.

### Coordinated Firebase Hosting release

Build the reviewed frontend with the target project's Firebase web configuration
and run the Firestore emulator suite before approval. For a hosted rehearsal, use
a separate staging Firebase project and build the frontend with that project's
configuration. A Hosting preview URL uses the backend selected by the build.

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
