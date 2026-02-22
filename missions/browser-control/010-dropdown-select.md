# Mission 010 - dropdown-select

## Metadata

- mission_id: `dropdown-select`
- index: `10`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/dropdown`
- goal: `select option 2 from dropdown`

## Proof Contract

- collect_fields:
  - `selectedValue`
  - `selectedText`

## Success Check (authoritative)

- `selectedValue == "2" and selectedText == "Option 2"`

## Example Proof Payload

```json
{
  "selectedValue": "2",
  "selectedText": "Option 2"
}
```

