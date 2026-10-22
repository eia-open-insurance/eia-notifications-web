# eia-notifications-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-notifications-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Notifications
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Notifications federated remote: screens, widgets, record tabs, and transaction composition. Notification rules, templates, routing, delivery, escalation, and acknowledgement.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## Implemented first slice

- React 19 and React DOM only at runtime; Webpack 5 Module Federation remote `eia_notifications` exposing `./App`.
- Async bootstrap (`index.jsx` loads `bootstrap.jsx`, which mounts React).
- Dev server port **3010**, proxying `/api` to `http://localhost:8100`.
- Workbench lists notifications, creates a draft, and sends a notification through the domain API with `X-EIA-Tenant`.
- Shared EIA operational record design: page head, notification queue, record header, summary grid, and
  Overview/Delivery/Template/Activity tabs; create is a dialog.
- URL record discovery: `?record={id|number}` opens a notification, `?new=1` opens the create dialog,
  and `popstate` keeps the workbench in step with shell navigation. A notification number missing from
  the loaded queue is resolved through `/api/v1/notifications/search`.
- Prefilled create links: `?new=1` also accepts `notificationType`, `channel`, `recipientPartyId`,
  `subject`, `body`, and `templateCode`; invalid enum values and non-UUID recipients fall back to the
  defaults, `?record=` ignores them, and an edited or normally opened draft is never overwritten.
  `DUNNING_NOTICE` is available in the notification type list.
- Prominent client-side queue filter over notification number, subject, recipient party, channel, and
  status, with a result count and Clear action.
- Predictive recipient party selection in the create form, backed by `/api/v1/parties/search`, with
  the party number/name label and a `/party?record=` cross-link.
- Overview recipient party cross-links, a "Why this matters" delivery context panel, and a related
  records note that does not invent the source business record the API slice does not expose.
- Activity tab reads `GET /api/v1/events/aggregate/{notificationId}?limit=50` with the tenant header
  and renders an event-derived, append-only timeline: timestamp, readable event name plus the raw
  type, inbox status, record version, and payload facts (channel, recipient party, type, status).
  The card refetches on selection, has card-local loading/empty/error states, refreshes on demand,
  and a 503 never blocks the notification record.
- `@swc/core` is pinned to exactly `1.10.7`.
- Playwright tests mock the API and cover list + detail, create, send, problem errors, URL discovery,
  create prefill (full, partial, invalid recipient, plain `new=1`, and no overwrite after an edit),
  queue filtering, the recipient picker payload, and the delivery context/cross-links.
- Playwright activity coverage for the aggregate path/limit/tenant header, newest-first order,
  payload facts, empty and 503 states, explicit refresh, and selection refetch.

## Local verification

```powershell
npm install
npm run build
npm test
```

`npm start` serves the remote at `http://localhost:3010`; `remoteEntry.js` is emitted by the production build.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
