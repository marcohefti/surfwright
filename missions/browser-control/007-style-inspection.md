# Mission 007 - style-inspection

## Metadata

- mission_id: `style-inspection`
- index: `7`
- status: `active`
- version: `1`

## Intent

- start_url: `https://getbootstrap.com/docs/5.3/components/buttons/`
- goal: `read computed padding-top on the primary button`

## Proof Contract

- collect_fields:
  - `paddingTopPx`

## Success Check (authoritative)

- `paddingTopPx == 6`

## Example Proof Payload

```json
{
  "paddingTopPx": 6
}
```
