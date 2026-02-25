# Mission 001 - first-pass-orientation

## Metadata

- mission_id: `first-pass-orientation`
- index: `1`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/`
- goal: `report feature-list bounds from the main content list`

## Proof Contract

- collect_fields:
  - `featureCount`
  - `firstFeature`
  - `lastFeature`

## Success Check (authoritative)

- `featureCount >= 40 and firstFeature == "A/B Testing" and lastFeature == "WYSIWYG Editor"`

## Example Proof Payload

```json
{
  "featureCount": 44,
  "firstFeature": "A/B Testing",
  "lastFeature": "WYSIWYG Editor"
}
```
