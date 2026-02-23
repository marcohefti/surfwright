# Mission 004 - first-pass-orientation

## Metadata

- mission_id: `first-pass-orientation`
- index: `4`
- status: `active`
- version: `1`

## Intent

- start_url: `https://developer.mozilla.org/en-US/`
- goal: `count visible top-level main navigation items without hover`

## Proof Contract

- collect_fields:
  - `navItemsCount`

## Success Check (authoritative)

- `navItemsCount == 9`

## Example Proof Payload

```json
{
  "navItemsCount": 9
}
```
