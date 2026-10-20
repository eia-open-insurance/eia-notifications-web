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
  Overview/Delivery/Template tabs; create is a dialog.
- `@swc/core` is pinned to exactly `1.10.7`.
- Playwright tests mock the API and cover list + detail, create, send, and problem errors.

## Local verification

```powershell
npm install
npm run build
npm test
```

`npm start` serves the remote at `http://localhost:3010`; `remoteEntry.js` is emitted by the production build.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
