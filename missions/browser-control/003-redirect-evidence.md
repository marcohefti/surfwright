# Mission 003 - redirect-evidence

## Metadata

- mission_id: `redirect-evidence`
- index: `3`
- status: `active`
- version: `1`

## Intent

- start_url: `http://example.com`
- goal: `prove redirect from requested to final URL`

## Proof Contract

- collect_fields:
  - `requestedUrl`
  - `finalUrl`
  - `wasRedirected`

## Success Check (authoritative)

- `requestedUrl starts with http://example.com and finalUrl == "https://example.com/" and wasRedirected == true`

## Example Proof Payload

```json
{
  "requestedUrl": "http://example.com",
  "finalUrl": "https://example.com/",
  "wasRedirected": true
}
```

