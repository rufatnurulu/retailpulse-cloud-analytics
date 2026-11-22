# Remaining manual step

Review and explicitly approve the role-aware Firestore Rules change in
`firestore.rules` on GitHub `main`. The live site keeps working with the
existing rules while this approval is pending.

1. In Firebase Console, open **Firestore Database → Rules** for
   `retailpulse-cloud-analytics`. Confirm the active baseline is the tested
   order-only policy from ruleset `1b8d2d75-ec37-41c4-bcde-5828d462e113`.
2. Review the proposed read permissions. Active Admin and Sales can read
   products, orders, and customers. Active Analyst can read products and
   orders. Active Inventory can read products. Each user can still read their
   own profile. Order and stock write permissions stay the same.
3. If this matrix is acceptable, reply with explicit approval to publish
   **only** the tested `firestore.rules` to `retailpulse-cloud-analytics`.
   Its SHA-256 is
   `905c136d7a38a73e9ecf82b2a690f125e0465a43b67eaaf0964e30a47b63a84f`.
   The verified baseline has been backed up outside Git. No account changes
   or new Hosting release are needed.
