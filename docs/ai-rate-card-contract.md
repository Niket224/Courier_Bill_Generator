# AI rate-card contract (Phase 4)

PDF extraction produces a review, never active pricing. The operator must verify the source quotation, fill unresolved values, save a server draft, then explicitly approve and publish it. The independent base charge is never inferred from weight times the extra-weight charge.

## Accepted uploads and limits

Authenticated, CSRF-protected multipart `pdf` uploads require a PDF filename, MIME type, actual signature, classic cross-reference pointer, terminal EOF, and successful structural parsing. Files must be nonempty, at most 10 MiB, 20 pages and 5,000 objects. Encrypted, interactive, embedded-file and compressed-object/xref-stream PDFs are conservatively rejected; re-export a plain PDF. This is a deliberately restricted PDF subset, not an antivirus guarantee. Damaged or unsupported structures fail closed.

Only one upload/provider operation is admitted per server process. Multer accepts one file and no extra fields. Upload time is bounded to 10 seconds, PDF validation to 3 seconds in a worker with 64 MiB old-generation/16 MiB young-generation V8 limits, and provider work to 25 seconds. These heap limits do not represent total process RSS; buffers and SDK serialization also consume bounded memory. Server request timeout is 45 seconds. Deploy with a matching reverse-proxy body limit and monitor RSS. No PDFs are stored or logged. Client review metadata is preserved locally, not the uploaded file.

## Provider compatibility

The maintained `@google/genai` SDK replaces the legacy package. See Google's [SDK guidance](https://ai.google.dev/gemini-api/docs/libraries), [migration guide](https://ai.google.dev/gemini-api/docs/migrate), and [Gemini 2.5 Flash model reference](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash).

`GEMINI_MODEL` defaults to documented `gemini-2.5-flash`. Google's current model page restricts 2.5 availability to accounts that previously used it: verify account entitlement and select an available documented model before staging. Syntax validation cannot verify model availability. No live extraction or model entitlement was tested. The optional server-only `GEMINI_API_KEY` is never returned to the browser.

`GEMINI_TIMEOUT_MS` is 1000–10000 (default 8000); `GEMINI_RETRIES` is 0–2 (default 2). SDK automatic retries are disabled. Only transient network, timeout and selected 5xx/408 failures receive bounded backoff. Credentials, quota, model availability and invalid output failures do not retry. Provider messages and raw model output are not returned or logged. Test mode refuses real SDK calls; all tests inject deterministic providers.

## Schema

The shared [contract](../mobile-bill-app/rate-card.js) accepts exactly:

```json
{
  "shipperCode": "SYNTHETIC",
  "clientInfo": {"clientName": "Synthetic client", "address": "", "quotationDate": "2026-01-01"},
  "globalRules": {"minWeightKg": null, "fuelSurchargePct": 20, "notes": ""},
  "rates": [{"targetName": "PATNA", "targetType": "CITY", "baseKg": 3,
    "baseRate": 50, "perKgRate": 15, "formula": "BASE_PLUS_EXTRA_PER_KG", "conditions": ""}]
}
```

Missing pricing values remain null/unresolved during extraction; zero is allowed only when explicit. Strict reviewed validation blocks unresolved fields, non-finite/negative values, invalid decimals/weights, duplicates, unknown fields and formulas. Maximum card size is 256 KiB with 1,000 rows. Extraction requires JSON numeric values; reviewed text inputs normalize through exact-decimal validation. AI output and PDF instructions are untrusted data, never HTML or executable instructions.

Supported destination types are CITY, STATE, CUSTOM_ZONE, REGION and DEFAULT. Phase 3 final-invoice verification currently matches exact CITY destinations only. Other types remain quote information and raise an approval warning. Conditions and notes are retained but not executed. Global minimums must agree with the selected row base-weight contract. Fuel is an explicit reviewed reference; it does **not** silently replace invoice fuel/tax settings. Warning acknowledgement cannot make an unsupported commercial formula executable: do not approve such a quotation for final billing until its calculation support exists.

The billing formula remains `(baseRate + max(0, weight-baseKg)*perKgRate)*pieces`, with the Phase 3 exact-decimal rounding contract. This phase adds provenance and approval, not a new formula.
