# Mission 003 - login-success

## Metadata

- mission_id: `login-success`
- index: `3`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/login`
- goal: `submit valid credentials and report secure area heading text`

## Proof Contract

- collect_fields:
  - `secureAreaHeading`

## Success Check (authoritative)

- `secureAreaHeading == "Secure Area"`

## Example Proof Payload

```json
{
  "secureAreaHeading": "Secure Area"
}
```
