# Monitoring and troubleshooting

## Available signals

| Signal | Meaning / action |
| --- | --- |
| GET /api/health/live | Process responds; does not claim MongoDB is available |
| GET /api/health/ready | 200 only when not draining and MongoDB ping/session-collection read complete within the bounded probe; otherwise 503 |
| GET /api/ops/status | Authenticated operator-only uptime, readiness, drain state and counters; no customer/configuration data |
| request log | Server-generated UUID, fixed area/method, status and elapsed milliseconds only |
| authFailures | Invalid/failed/throttled sign-ins and CSRF failures in auth routes; investigate repeated failures without logging usernames/passwords |
| invoiceFailures / rateFailures | Rejected writes, conflicts, expiry or outage; preserve the pending request and check History before new requests |
| aiFailures | Upload/provider/schema failures or throttling; preserve reviewed data and check model/quota separately |
| serverErrors and database events | Dependency/storage errors; check readiness and host health |
| backup job receipt/exit | Last attempt/outcome and last verified-copy timestamp; nonzero means no success claim |
| monitor exit | Backend/readiness, backup age, missing archive/copy or low-capacity alert |
| restore CLI exit/marker | Failed/interrupted target stays quarantined; never clear marker to bypass verification |

Counters are bounded and process-local and reset on restart. They are not a durable accounting or security audit log. Logs intentionally omit request URLs/query strings, bodies, cookies, tokens, user IDs, invoice numbers, response bodies, provider text and raw exception messages. This prevents correlation IDs from becoming customer identifiers. Unknown caller request IDs are ignored. Existing safe API messages remain generic; use the returned request ID to correlate failures.

The example proxy access log also avoids request paths and query values. Confirm the actual hosting provider does not separately log bodies, cookies, environment variables or sensitive URLs. Restrict log access and set an operator-approved rotation/retention policy; no remote log service is configured.

## Lightweight external checks — approval required

Use the existing host's service supervisor and scheduler first. An approved monitor can poll readiness about once per minute and run `npm run ops:monitor` against protected local backup receipts. Send only alert codes/timestamps to the operator through an approved email/webhook/uptime service. No account, paid plan, webhook or outbound notification was created or sent in this task. External alert delivery is **BLOCKED until configured and tested**.

Suggested starting thresholds (not activated): three consecutive readiness failures, any failed backup attempt, backup age over 24 hours, either destination below 256 MiB, repeated invoice 5xx or a sudden increase in auth/AI failures. Tune with the operator after observing real normal usage. Avoid paging on each expected 401/409 validation conflict.

## Failure response

1. **App unavailable:** check supervisor process/exit and liveness. Inspect safe startup events and required variable names. Do not paste the environment into logs or support chats.
2. **Live but not ready:** verify network/database permissions, restore quarantine and session-store availability. Do not bypass auth, CSRF or quarantine. Retry the original pending invoice request only after recovery.
3. **Login loops after deployment:** verify HTTPS, Secure cookie, exact origin and trusted proxy address. Never weaken cookie flags or set broad proxy trust as a workaround.
4. **Invoice save failed/unknown:** keep the draft, reload authenticated History, retry the preserved request ID. Never issue another invoice number merely to hide an uncertain result.
5. **Backup failed/stale/missing:** preserve last good archive and key; check exclusive lock, actual free space, source replica-set support, 64 MiB limit, copy mount and permissions. Run and verify manually after resolving the fault. A recent receipt without its archive is not healthy.
6. **Restore verification failed:** retain the quarantined target for investigation. Retry a verified archive into a new isolated database; do not overwrite the live database.
7. **AI failures:** check only safe error codes, quota/model entitlement and supported PDF requirements; do not log or email customer PDFs automatically.
8. **Protocol mismatch or partial update:** preserve encrypted drafts and follow [rollback](rollback.md); do not disable the version check to force a write.
