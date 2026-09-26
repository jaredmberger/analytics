# Curator Analytics Recovery Export

Curator Analytics provides a complete, read-only backup of the `CURATOR_ANALYTICS_RECORDS` Cloudflare KV namespace at:

`GET /api/recovery-export`

## Security

Configure the Worker secret:

`RECOVERY_EXPORT_TOKEN`

Send it as:

`X-Curator-Recovery-Key: <RECOVERY_EXPORT_TOKEN>`

If the secret is absent, the endpoint remains disabled.

## Scope

The exporter paginates every key in `CURATOR_ANALYTICS_RECORDS` and preserves exact key/value pairs. It intentionally does not assume specific key families so future analytics records remain covered automatically.

Each backup includes:

- export timestamp
- namespace identity
- total key count
- SHA-256 integrity metadata
- complete key/value payload

The downloaded filename is:

`curator-analytics-recovery-<timestamp>.json`

## Validation

```bash
node scripts/validate-recovery-backup.mjs /path/to/curator-analytics-recovery-....json
```

## iPad / iPhone backup

Use Shortcuts:

1. Get Contents of URL
2. URL: `https://analytics.oceanliners.net/api/recovery-export`
3. Method: GET
4. Header: `X-Curator-Recovery-Key` = the configured recovery token
5. Save File

## Restore policy

There is intentionally no production restore endpoint. Any restore should first target a disposable KV namespace and be verified before production is considered.
