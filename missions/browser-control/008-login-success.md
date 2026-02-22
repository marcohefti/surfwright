# Mission 008 - login-success

## Metadata

- mission_id: `login-success`
- index: `8`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/login`
- goal: `submit valid credentials and verify auth success state`

## Proof Contract

- collect_fields:
  - `secureArea`
  - `flash`

## Success Check (authoritative)

- `secureArea == true and flash contains "You logged into a secure area!"`

## Example Proof Payload

```json
{
  "secureArea": true,
  "flash": "You logged into a secure area!"
}
```

