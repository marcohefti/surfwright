# Mission 014 - table-sort-lastname

## Metadata

- mission_id: `table-sort-lastname`
- index: `14`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/tables`
- goal: `sort table by last name and verify bounds`

## Proof Contract

- collect_fields:
  - `rowCount`
  - `firstLast`
  - `lastLast`

## Success Check (authoritative)

- `rowCount == 4 and firstLast == "Bach" and lastLast == "Smith"`

## Example Proof Payload

```json
{
  "rowCount": 4,
  "firstLast": "Bach",
  "lastLast": "Smith"
}
```

