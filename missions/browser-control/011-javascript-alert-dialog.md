# Mission 011 - javascript-alert-dialog

## Metadata

- mission_id: `javascript-alert-dialog`
- index: `11`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/javascript_alerts`
- goal: `handle JS alert and verify result text`

## Proof Contract

- collect_fields:
  - `dialogText`
  - `result`

## Success Check (authoritative)

- `dialogText == "I am a JS Alert" and result == "You successfully clicked an alert"`

## Example Proof Payload

```json
{
  "dialogText": "I am a JS Alert",
  "result": "You successfully clicked an alert"
}
```

