# RetailPulse final release report

| Item | Verified result |
| --- | --- |
| Final release commit | [`35515a010c686150b11f0774a65e8b3a6bea890a`](https://github.com/rufatnurulu/retailpulse-cloud-analytics/commit/35515a010c686150b11f0774a65e8b3a6bea890a) |
| Application source tested and built | `135dce544100a5f09cc6e3564504dad244c57313`. The subsequent release and report commits contain documentation and screenshots only. |
| Live URL | [retailpulse-cloud-analytics.web.app](https://retailpulse-cloud-analytics.web.app) |
| Install and dependency audit | `npm ci` succeeded. `npm audit` reported zero vulnerabilities. |
| Automated tests | `npm test` passed 5 analytics and CSV tests and 10 Firestore emulator tests. |
| Production build | `npm run build` passed. Largest JavaScript chunk was 486.55 kB before gzip. |
| Hosting | All 11 public files matched the verified build byte-for-byte. No Hosting redeployment was needed. |
| Firestore | Production rules unchanged. The tested role-aware rules await approval. |

## Browser verification

On local Firebase emulators, Chrome verified invalid sign-in, inactive and
missing profiles, unrecognized roles, session persistence, sign-out, and the
workspace for all four roles. It checked exact fixture KPIs, charts, year,
month and category filters, empty states, CSV contents, product search and
selection, stock increases and decreases, duplicate-submit prevention,
atomic order creation, and live dashboard updates. No runtime console
errors were observed. The README screenshots come from this emulator run.

On the public site, Chrome verified the dark sign-in page, title, branding,
and responsive layout at desktop and mobile widths without console errors.
Authenticated production workflows were untested because no production test
credentials were available. All test writes used synthetic emulator
documents.

## Security review

The live ruleset `1b8d2d75-ec37-41c4-bcde-5828d462e113` retains the
working order and stock write policy. It currently permits signed-in users
to read products, orders, and customers directly. The reviewed candidate
requires an active, recognized role for those reads. Admin and Sales keep
all three reads, Analyst keeps product and order reads, and Inventory
keeps product reads. Users can still read their own profiles. Order and
stock permissions for valid roles are preserved.

Tests cover direct allowed and denied operations, malformed profiles and
revocation, historical order reads, incorrect price and total, standalone
stock deductions, overselling, and failed writes leaving stock intact.
The standard order transaction's two writes use at most five and six
rule document lookups respectively before caching. The two transaction
reads can add two profile lookups each. That is within Firestore's
per-operation and aggregate limits. [Firebase rules access limits](https://firebase.google.com/docs/firestore/security/rules-conditions#access_call_limits)

The live rules were verified by content and backed up outside Git. The
proposed rules SHA-256 is
`905c136d7a38a73e9ecf82b2a690f125e0465a43b67eaaf0964e30a47b63a84f`.
The production bundle scan found no private credential signatures. No
production data, accounts, rules, IAM, or billing were modified.

## Remaining approval and limitations

Approve publishing only the reviewed role-aware Firestore Rules to
`retailpulse-cloud-analytics`. Follow [the remaining manual step](../MANUAL_FINAL_STEPS.md). The live read policy stays in effect until
approval and publication.

The demo loads the allowed collections in the browser, which limits its
suitability for large datasets. An order whose client date differs from the
server's UTC date is rejected atomically and can be retried with a correct
clock and current UTC date.
