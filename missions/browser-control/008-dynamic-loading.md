# Mission 008 - dynamic-loading

## Metadata

- mission_id: `dynamic-loading`
- index: `8`
- status: `active`
- version: `3`

## Intent

- start_url: `https://the-internet.herokuapp.com/dynamic_loading/1`
- goal: `start async load and verify final content appears`

## Proof Contract

- collect_fields:
  - `finishText`

## Success Check (authoritative)

- `finishText contains "Hello World!"`

## Example Proof Payload

```json
{
  "finishText": "Hello World!"
}
```
