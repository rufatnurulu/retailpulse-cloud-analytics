# RetailPulse Cloud Analytics · University presentation

## Slide 1 · What RetailPulse solves

- Retail sales analysis and inventory operations in one workspace.
- Two questions drive the interface: what sold, and what stock is available now?

**Speaker notes.** Introduce the project as a university portfolio application using demo retail records. Explain that tracking sales and inventory in separate workflows makes it harder to connect a sale to the stock it consumes.

## Slide 2 · Live product walkthrough

- Overview, Analytics, Orders, and Inventory views.
- Dark responsive layout with navigation and actions tailored to the signed-in role.

**Speaker notes.** Show the desktop overview screenshot first. Explain how the year, month, and category selectors change the report. Show the mobile inventory screenshot to demonstrate how the table reflows. Use screenshots for the presentation if there is no dedicated demo account.

## Slide 3 · Architecture and technology

- Vite, JavaScript, HTML, CSS, and Chart.js in the browser.
- Firebase Authentication for identity, Firestore for data and policy, Firebase Hosting for the static build.

**Speaker notes.** Trace the request from sign-in to the user's profile and then to the data collections enabled for the role. The client draws the charts from stored orders. Firestore validates access and writes before committing them.

## Slide 4 · Data model

- Users, products, customers, and orders.
- Product and customer business IDs connect historical data. New orders also store document references and a server timestamp.

**Speaker notes.** Show the four collections. Explain why the order stores its unit price even when the product's current price can change later. Distinguish current stock from historical sales.

## Slide 5 · Business intelligence and methodology

- Revenue and average order value use completed orders with valid totals.
- Order count uses all matching statuses. Unique customers counts distinct nonempty IDs.
- Charts and CSV export share the period and category selection.

**Speaker notes.** Demonstrate how changing the year avoids combining orders for the same month in different years. Explain that the product chart ranks completed revenue, and the CSV lets a reviewer reproduce the filtered totals in a spreadsheet.

## Slide 6 · Authentication, roles, and security

- Admin and Sales can place orders. Admin and Inventory can adjust stock. Analyst can analyze orders without customer-directory access under the proposed rules.
- Active profiles control access. Clients cannot grant themselves roles.

**Speaker notes.** Separate sign-in from authorization. Explain that the live order and stock write rules are enforced. Direct collection reads on production are still broader than the dashboard role matrix. The tested role-aware read rules require owner approval before they can be published.

## Slide 7 · Atomic orders and inventory integrity

- Read the customer, product, current price, and available stock.
- Validate the quantity and total, then commit the order and stock deduction together.
- When another sale consumes the available stock, an overselling attempt fails without leaving an order.

**Speaker notes.** Use a three-unit product and two simultaneous two-unit orders to explain the concurrency test. Explain that independent stock changes only update the stock field and require the appropriate role. Run transaction demonstrations with emulator data.

## Slide 8 · Testing and deployment

- Analytics and CSV tests, Firestore permission and transaction tests, and desktop and mobile Chrome checks.
- A production Vite build is served by Firebase Hosting. Rules use a separate reviewed release.

**Speaker notes.** Describe the emulator fixtures and how tests prove both allowed and denied behavior. Show the release report for the exact results. Explain that no production records are needed for destructive or write-heavy tests.

## Slide 9 · Results and lessons learned

- A hosted portfolio application joins analytics, access control, and inventory workflows.
- Key lessons: make KPI definitions explicit, enforce writes at the data boundary, and test negative cases.

**Speaker notes.** Summarize the project as evidence of dashboard development, cloud integration, and transactional data integrity. Mention the current role-read rollout gate and how larger datasets could be handled with aggregate queries and pagination.
