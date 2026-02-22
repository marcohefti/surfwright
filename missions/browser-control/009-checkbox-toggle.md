# Mission 009 - checkbox-toggle

## Metadata

- mission_id: `checkbox-toggle`
- index: `9`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/checkboxes`
- goal: `toggle first checkbox deterministically`

## Proof Contract

- collect_fields:
  - `checkedBefore`
  - `checkedAfter`

## Success Check (authoritative)

- `checkedBefore == 1 and checkedAfter == 2`

## Example Proof Payload

```json
{
  "checkedBefore": 1,
  "checkedAfter": 2
}
```

