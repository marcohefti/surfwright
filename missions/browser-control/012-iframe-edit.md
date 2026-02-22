# Mission 012 - iframe-edit

## Metadata

- mission_id: `iframe-edit`
- index: `12`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/iframe`
- goal: `edit TinyMCE iframe body and verify content`

## Proof Contract

- collect_fields:
  - `ok`
  - `text`

## Success Check (authoritative)

- `ok == true and text == "ZCL_IFRAME_TEST"`

## Example Proof Payload

```json
{
  "ok": true,
  "text": "ZCL_IFRAME_TEST"
}
```

