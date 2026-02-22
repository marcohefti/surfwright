# Mission 006 - multimatch-disambiguation

## Metadata

- mission_id: `multimatch-disambiguation`
- index: `6`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/add_remove_elements/`
- goal: `act on 2nd matching element deterministically`

## Proof Contract

- collect_fields:
  - `deleteButtonsAfter`

## Success Check (authoritative)

- `deleteButtonsAfter == 2`

## Example Proof Payload

```json
{
  "deleteButtonsAfter": 2
}
```

