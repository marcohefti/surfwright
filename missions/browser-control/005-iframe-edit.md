# Mission 005 - iframe-edit

## Metadata

- mission_id: `iframe-edit`
- index: `5`
- status: `active`
- version: `5`

## Intent

- start_url: `https://the-internet.herokuapp.com/iframe`
- goal: `set editor text to any non-empty probe string and verify readback`

## Proof Contract

- collect_fields:
  - `writeText`
  - `readBackText`
  - `writeMatches`

## Success Check (authoritative)

- `writeText is non-empty and readBackText is non-empty and writeMatches == true`

## Example Proof Payload

```json
{
  "writeText": "probe string",
  "readBackText": "probe string",
  "writeMatches": true
}
```
