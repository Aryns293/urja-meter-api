# Urja Meter Ops protocol notes

These notes describe the portal behavior observed through normal logged-in use and browser network inspection on 3 November 2026. The portal has no documented public API; these are internal endpoints and may change without notice.

## Authentication

The sign-in page submits a form-encoded POST, not a JSON POST:

```http
POST /login
Origin: https://urja-ops.flockenergy.tech
Content-Type: application/x-www-form-urlencoded

email=<email>&password=<password>
```

A successful request returns HTTP 200 with a SvelteKit action result:

```json
{
  "type": "redirect",
  "status": 303,
  "location": "/meters"
}
```

It also sets this cookie:

```text
__Secure-better-auth.session_token=<token>; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax
```

The token must be sent as the `Cookie` header on subsequent requests. The one-hour lifetime is used by the service to renew the session shortly before expiry.

Observed authentication quirks:

- JSON login returns HTTP 415 (`Unsupported Media Type`).
- A form POST without the same-origin `Origin` header returns HTTP 403 (`Cross-site POST form submissions are forbidden`).
- Invalid credentials are wrapped in an HTTP 200 SvelteKit action result with `type: "failure"` and an inner status of 401.
- Unauthenticated `/portal/...` data requests return HTTP 401 JSON.
- Unauthenticated SvelteKit `__data.json` requests can instead return HTTP 200 containing a redirect to `/login`. The adapter treats both forms as an expired session.

## Available data and endpoints

### Meter list and search

```http
GET /portal/meters/search?q=<query>&page=<page>
Cookie: __Secure-better-auth.session_token=<token>
```

The query matches meter IDs and serial numbers. Results are paginated at a fixed 20 records per page. At investigation time there were 403 meters across 21 pages.

```json
{
  "data": [
    {
      "meterId": "J100000",
      "serialNo": "SE33962",
      "make": "HPL",
      "phaseType": "single",
      "installStatus": "Decommissioned",
      "dtCode": "DT-001"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "total": 403
}
```

### Meter nameplate and hierarchy

```http
GET /meters/{meterId}/__data.json
Cookie: __Secure-better-auth.session_token=<token>
```

Meter detail is server-rendered by SvelteKit. Its data endpoint returns a `nodes` array; the meter page node has `type: "data"` and a flattened `data` array. Decoding that array with `devalue.unflatten` produces an object containing:

- `detail.data`: label/value pairs for Meter ID, Serial No, Make, Phase Type, Installation Status, and Installation Type
- `hierarchy`: Zone, Circle, Division, Subdivision, Sub Station, Feeder, and DT

Hierarchy values combine display name and code, for example `Malviya Nagar DT 1 (DT-001)`. The new API separates these into `name` and `code` fields.

There is no equivalent JSON detail resource at `/portal/meters/{meterId}`; that path returned 404 during investigation.

### Meter location

```http
GET /portal/meters/{meterId}/geo
Cookie: __Secure-better-auth.session_token=<token>
```

```json
{
  "data": {
    "latitude": "26.938961002479868",
    "longitude": "75.83095696146852"
  }
}
```

Coordinates are strings in this response. A missing meter returns 404 with `error: "not_found"`.

### Recent consumption

```http
GET /portal/meters/{meterId}/energy
Cookie: __Secure-better-auth.session_token=<token>
```

The sampled meter returned 337 half-hour readings from 23 June 2026 at 23:30 through 30 June 2026 at 23:30, inclusive.

```json
{
  "data": [
    {
      "timestamp": "23/06/2026 23:30",
      "kwh": "48438.74",
      "kvah": "52313.84",
      "voltR": "226"
    }
  ]
}
```

The energy values are cumulative register values, not per-interval consumption deltas. Numeric values are encoded as strings. Timestamps use `DD/MM/YYYY HH:mm` and include no timezone or offset; the API assumes India Standard Time based on the Jaipur network and converts them to UTC.

### Distribution transformers

```http
GET /portal/dts?page=<page>
Cookie: __Secure-better-auth.session_token=<token>
```

Returns 20 records per page with `code`, `name`, `feederCode`, and numeric `capacityKva`. There were 40 transformers across two pages at investigation time.

### Signed full export

The Transformers page's “Export all meters” action first obtains a signing secret:

```http
GET /portal/keys
Cookie: __Secure-better-auth.session_token=<token>
```

The response contains `data.signingSecret`. The secret is used as an HMAC-SHA256 key. For the export used by the UI, the exact signed payload is four lines:

```text
GET
/portal/export
page=1
<unix-timestamp-in-seconds>
```

In pseudocode:

```text
signature = lowercaseHex(HMAC-SHA256(signingSecret, payload))
```

The export request then includes the timestamp and signature:

```http
GET /portal/export?page=1
Cookie: __Secure-better-auth.session_token=<token>
x-timestamp: <same-unix-timestamp>
x-signature: <hex-hmac>
```

A missing or invalid signature returns HTTP 401 with `error: "signature_invalid"`.

Although the query says `page=1`, the UI uses this as a full export. It returned all 403 meters in one response, with `total: 403`. Each record includes nameplate fields, `build`, numeric `geo.lat`/`geo.lng`, and a structured hierarchy with separate names and codes.

The export contained both `legacy` and `v2` build labels (238 and 165 records respectively). Their sampled schema was the same. Some hierarchy data is not perfectly consistent: for example, the final record referenced `DT-007` with the name `Old Malviya Nagar Xfmr`, while the transformer list describes that code as `Sanganer DT 7`. The service preserves source values rather than silently trying to repair them.

## Robustness implications

- Internal SvelteKit and `/portal` contracts can change independently of the UI, so upstream response validation is necessary.
- Session expiry appears as two different unauthorized shapes depending on the endpoint.
- Export signatures must use the exact path and raw query string; signing a full URL or reordered payload will not match.
- The full export is convenient for a future local index, but fetching it for every single-meter lookup would be wasteful. The implementation uses the smaller per-meter endpoints and reserves export for the export route.
