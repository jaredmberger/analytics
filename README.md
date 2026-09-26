# analytics  to me

## Disaster recovery

The complete `CURATOR_ANALYTICS_RECORDS` namespace can be exported through authenticated `GET /api/recovery-export`. Configure the Worker secret `RECOVERY_EXPORT_TOKEN`; the route remains disabled if the secret is absent. See [`RECOVERY_EXPORT.md`](RECOVERY_EXPORT.md) for backup and validation instructions.
