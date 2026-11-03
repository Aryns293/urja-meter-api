# Urja Meter API

A small Node.js/Express service that makes the read-only Urja Meter Ops portal consumable as a JSON REST API. It handles the portal's form login, session cookie, SvelteKit data format, consumption timestamps, and signed bulk export internally.

## What is included

- Meter search with pagination
- Aggregated meter nameplate, location, and full network hierarchy
- Recent consumption with numeric readings and ISO 8601 timestamps
- Distribution transformer listing
- Full meter export using the portal's HMAC-signed export flow
- Lazy authentication, shared sessions, one re-authentication retry, and request timeouts
- Input validation and consistent JSON errors
- Offline unit and route tests

The service only performs read operations against the portal.

## Quick start

Requirements: Node.js 22 or newer and npm.

```bash
npm install
cp .env.example .env
```

Edit `.env` with the portal credentials supplied in the assignment, then start the service:

```bash
npm run dev
```

The API listens on `http://localhost:3000`. For a normal production-style start, use `npm start`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Local HTTP port |
| `PORTAL_BASE_URL` | Portal URL in `.env.example` | Portal origin, without a trailing slash |
| `PORTAL_EMAIL` | None | Portal login email |
| `PORTAL_PASSWORD` | None | Portal login password |
| `PORTAL_TIMEOUT_MS` | `10000` | Timeout for each portal request |

`.env` is ignored by git. Neither portal credentials nor the export signing secret are returned by the API.

## API overview

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Local service health; does not call the portal |
| `GET` | `/api/v1/meters?q=&page=1` | Search by meter ID or serial number |
| `GET` | `/api/v1/meters/{meterId}` | Nameplate, coordinates, and network hierarchy |
| `GET` | `/api/v1/meters/{meterId}/consumption` | Recent half-hour cumulative energy readings |
| `GET` | `/api/v1/meters/export` | Normalized full dataset |
| `GET` | `/api/v1/transformers?page=1` | Paginated distribution transformers |
| `GET` | `/openapi.json` | OpenAPI 3 description of this API |

The complete machine-readable contract is in [openapi.json](./openapi.json).

### Example: search

```bash
curl 'http://localhost:3000/api/v1/meters?q=J100000&page=1'
```

```json
{
  "data": [
    {
      "meterId": "J100000",
      "serialNumber": "SE33962",
      "make": "HPL",
      "phaseType": "single",
      "installationStatus": "Decommissioned",
      "distributionTransformerCode": "DT-001"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### Example: meter detail

```bash
curl 'http://localhost:3000/api/v1/meters/J100000'
```

The response contains the six nameplate fields, numeric latitude/longitude, and these hierarchy levels in order: zone, circle, division, subdivision, substation, feeder, and distribution transformer. Each hierarchy node has a separate `name` and `code`.

### Example: consumption

```bash
curl 'http://localhost:3000/api/v1/meters/J100000/consumption'
```

Each reading contains `timestamp`, `cumulativeKwh`, `cumulativeKvah`, and `voltageR`. The values are cumulative register readings, not deltas calculated by this service. Metadata includes the count and first/last timestamps.

### Errors

Errors have a stable envelope and do not expose upstream HTML, credentials, or stack traces:

```json
{
  "error": {
    "code": "not_found",
    "message": "Meter not found"
  }
}
```

Validation failures use HTTP 400. Missing meters use 404. Portal availability and unexpected-response failures use 502, portal rate limiting uses 503, and portal timeouts use 504.

## Structure and request flow

```text
src/
  app.js                    Express composition and utility routes
  server.js                 Configuration and process entry point
  config.js                 Environment validation
  routes/                   Public HTTP endpoints
  middleware/               Validation and JSON error handling
  portal/
    client.js               Login, session, retries, signing, portal requests
    schemas.js              Validation of upstream responses
    mappers.js              Portal-to-public data normalization
test/                       Offline route, mapper, and adapter tests
```

A request flows through an Express route, input validation, and `PortalClient`. The client lazily creates one shared session, calls the appropriate portal endpoint, validates the response, and maps it to a stable public shape. Meter detail is the only aggregated operation: it fetches SvelteKit nameplate/hierarchy data and the separate geo endpoint concurrently.

## Design decisions and trade-offs

- **No HTML scraping.** The detail page's `__data.json` response is decoded with `devalue.unflatten`. This is less brittle than selecting rendered DOM elements, although it still depends on an internal SvelteKit contract.
- **Native fetch instead of an HTTP client dependency.** Node 22+ provides the required fetch, cookie-header, and timeout primitives, so Axios would not add much here.
- **Validation at both boundaries.** Zod validates incoming query/path parameters and upstream JSON before mapping. Unexpected portal changes become a safe 502 rather than malformed API responses.
- **No response cache or database.** Every request reflects current portal data. This avoids stale data and keeps the submission small. The session itself is cached because re-logging in for every request would be wasteful.
- **One retry only.** An expired session triggers re-authentication and one retry. Other upstream failures are not blindly retried, avoiding duplicate load and hidden latency.
- **No built-in consumer authentication.** The assignment asks for portal authentication, not a multi-tenant public service. A real deployment should put this backend behind the organization's API gateway or service authentication.
- **India Standard Time assumption.** Portal timestamps have no offset. Because the network and locations are in Jaipur, they are interpreted as `Asia/Kolkata` (`+05:30`) and returned in UTC ISO format.

## Testing

```bash
npm test
```

The tests use no network. They cover route behavior, validation, error mapping, timestamp and hierarchy normalization, login/session reuse, expired-session retry, SvelteKit decoding, and the exact export HMAC payload.

The implementation was also checked against the live portal for search, detail, consumption, transformers, full export, unknown meters, and invalid parameters.

## Intentionally left out

- A frontend dashboard, since the core deliverable is the backend API.
- A local searchable index and geospatial queries. The export makes these possible, but 403 records do not justify adding a database to this submission.
- Response caching and a circuit breaker. Their TTL and failure thresholds should be chosen from real traffic and freshness requirements.
- Consumer authentication, rate limiting, and deployment configuration, which belong at the deployment boundary for this exercise.

See [PROTOCOL.md](./PROTOCOL.md) for the reverse-engineered portal behavior and [REFLECTION.md](./REFLECTION.md) for assumptions, difficulties, and future improvements.
