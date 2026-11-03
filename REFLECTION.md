# Reflection

## Assumptions

I assumed the portal's consumption timestamps are in India Standard Time because they have no offset and the meter network is in Jaipur. The API makes that assumption explicit and converts timestamps to UTC rather than letting the server's local timezone decide. I also treated kWh and kVAh as cumulative register readings because their values increase across the sampled series; I did not turn them into interval deltas without a documented meter-reset or rollover rule.

## Most difficult part

The meter detail page did not have a straightforward JSON endpoint like search, geo, and energy. Its nameplate and hierarchy were embedded in SvelteKit's flattened `__data.json` representation. Inspecting the response structure and then decoding it with `devalue.unflatten` gave a cleaner solution than scraping HTML. The export added a second investigation step: the browser source showed the exact four-line HMAC payload, which explained why a plain export request returned `signature_invalid`.

## A mistake I made

I initially assumed the login endpoint accepted JSON because the browser request returned JSON. It returned 415, so I checked the form behavior more closely and switched to URL-encoded form data. My first form attempt then failed the same-origin check because I had omitted the `Origin` header. This was a useful reminder that a JSON response does not imply a JSON request, and that authentication behavior should be verified from the actual request rather than inferred.

## What I would improve with another day

I would add a small TTL cache in front of the full export and use it for a local indexed query layer with filters for status, phase, make, and hierarchy. I would also add contract tests with recorded representative fixtures for both `legacy` and `v2` records, plus metrics for portal latency, session renewals, retries, and upstream failures. If this were deployed for other teams, I would add consumer authentication and rate limiting at an API gateway and agree on freshness requirements before choosing cache durations.

## Self-review criticism

The service still depends on undocumented portal internals, especially the SvelteKit node layout and hierarchy labels. Validation turns unexpected changes into safe 502 responses, but it cannot prevent an upstream deployment from breaking integration. There is also no resilience beyond timeouts and one authentication retry, and the full export is not paginated from the consumer's perspective. Those are deliberate scope choices for this exercise, not production-completeness claims. Finally, the timezone and cumulative-reading assumptions should be confirmed with the utility before using the data for billing or analytics.
