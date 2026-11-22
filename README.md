# RetailPulse Cloud Analytics

RetailPulse is a university portfolio project for retail sales analysis and inventory operations. It presents Firestore demo data in a dark-first, responsive business intelligence workspace with role-based access.

**Live demo** [RetailPulse on Firebase Hosting](https://retailpulse-cloud-analytics.web.app). An existing RetailPulse account with an active role is required.

## Screenshots

The desktop overview and mobile inventory were captured in Chrome with the repository's demo data loaded into local Firebase emulators.

![RetailPulse desktop overview](docs/screenshots/overview.jpg)

[View the mobile inventory screenshot](docs/screenshots/mobile-inventory.jpg)

## Features

- Sales KPIs, monthly revenue, and top products from stored orders, with year, month, and category filters.
- A searchable product catalog with stock status and independent stock adjustments.
- Order entry with Firestore validation and an atomic stock deduction.
- CSV export of the same orders used by the analytics filters.

Revenue and average order value use completed orders. Order count uses all matching statuses. Unique customer count uses distinct nonempty customer IDs from those orders. CSV output preserves the selected filters and escapes spreadsheet formula prefixes. The inventory table shows current stock independently of the historical sales period and follows the category filter.

| Role | Products | Orders and analytics | Customer directory | Create orders | Adjust stock | CSV button |
| --- | --- | --- | --- | --- | --- | --- |
| Admin | Read | Read | Read | Yes | Yes | Yes |
| Sales | Read | Read | Read | Yes | — | — |
| Inventory | Read | — | — | — | Yes | — |
| Analyst | Read | Read | — | — | — | Yes |

The table describes the workspace and the proposed direct Firestore read policy. The live rules currently allow any authenticated account to read products, customers, and orders directly. Role-aware reads in this repository are pending approval.

## Architecture

The Vite frontend uses HTML, CSS, JavaScript, and Chart.js. Firebase Authentication handles email/password sign-in. The app watches the signed-in user's profile at `users/{uid}` and loads the permitted Firestore collections. Firestore Rules enforce backend access. Inventory changes and order creation use Firestore transactions. Firebase Hosting serves the static build. Python scripts and CSV files supplied the original demo dataset.

New orders reference existing product and customer documents, use a server timestamp and UTC order date, and commit with the exact stock deduction. Firestore validates the quantity, current unit price, and rounded total. Existing historical orders require no migration. This rule set also preserves stock increases and decreases for active admins and inventory users.

## Local setup

1. Install Node.js 24.12 or newer and run `npm ci`.
2. Create an ignored `.env.local` from your Firebase web app configuration. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. Use web app values only.
3. Run `npm run dev` to open the app or `npm run build` to build it.
4. With the Firebase CLI and Java 21+ on your PATH, run `npm test`. Firestore tests use the isolated `demo-retailpulse` project.

Firebase profile documents need an approved lowercase `role` and Boolean `active: true`. The production Admin SDK key belongs outside frontend assets and Git. The legacy Python import script replaces documents by ID and is unnecessary for routine use of the hosted demo.

## Status

The hosted dashboard, independent stock adjustments, and atomic order creation are live. The active production ruleset is `1b8d2d75-ec37-41c4-bcde-5828d462e113`. The pending rules change narrows collection reads to the workspace roles above and preserves the live order and stock write permissions. See [Manual final steps](MANUAL_FINAL_STEPS.md).

Order dates use UTC. A submission that crosses midnight UTC between the client timestamp and the server commit can be rejected safely and retried with the new date. Failed orders leave inventory unchanged.

## CV summary

Built and hosted a role-based retail analytics dashboard using Vite, Firebase, Firestore, and Chart.js. Implemented sales KPIs and CSV reporting, secured inventory workflows, and tested atomic order processing with the Firestore emulator.
