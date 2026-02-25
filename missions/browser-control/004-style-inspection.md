# Mission 004 - style-inspection

## Metadata

- mission_id: `style-inspection`
- index: `4`
- status: `active`
- version: `2`

## Intent

- start_url: `https://example.com/`
- goal: `capture one short network sample and one short trace insight`

## Proof Contract

- collect_fields:
  - `networkRequestCount`
  - `networkTopHost`
  - `traceInsightName`

## Success Check (authoritative)

- `networkRequestCount >= 1 and networkTopHost == "example.com" and traceInsightName == "top-host"`

## Example Proof Payload

```json
{
  "networkRequestCount": 1,
  "networkTopHost": "example.com",
  "traceInsightName": "top-host"
}
```
