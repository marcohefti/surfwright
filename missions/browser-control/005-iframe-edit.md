# Mission 005 - iframe-edit

## Metadata

- mission_id: `iframe-edit`
- index: `5`
- status: `active`
- version: `3`

## Intent

- start_url: `https://the-internet.herokuapp.com/iframe`
- goal: `report frame count, set editor text to probe string, and read it back`

## Proof Contract

- collect_fields:
  - `frameCount`
  - `editorText`

## Success Check (authoritative)

- `frameCount >= 2 and editorText == "SURFWRIGHT IFRAME PROBE"`

## Example Proof Payload

```json
{
  "frameCount": 2,
  "editorText": "SURFWRIGHT IFRAME PROBE"
}
```
