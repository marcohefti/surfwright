# Mission 005 - login-success

## Metadata

- mission_id: `login-success`
- index: `5`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/login`
- goal: `submit valid credentials and report the secure-area h4 text`

## Proof Contract

- collect_fields:
  - `secureAreaH4`

## Success Check (authoritative)

- `secureAreaH4 == "Welcome to the Secure Area. When you are done click logout below."`

## Example Proof Payload

```json
{
  "secureAreaH4": "Welcome to the Secure Area. When you are done click logout below."
}
```
