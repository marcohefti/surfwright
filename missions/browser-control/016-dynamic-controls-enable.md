# Mission 016 - dynamic-controls-enable

## Metadata

- mission_id: `dynamic-controls-enable`
- index: `16`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/dynamic_controls`
- goal: `enable disabled input and verify state`

## Proof Contract

- collect_fields:
  - `enabled`
  - `message`

## Success Check (authoritative)

- `enabled == true and message == "It's enabled!"`

## Example Proof Payload

```json
{
  "enabled": true,
  "message": "It's enabled!"
}
```

