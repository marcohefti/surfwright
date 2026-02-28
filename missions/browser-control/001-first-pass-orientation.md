# Mission 001 - first-pass-orientation

## Metadata

- mission_id: `first-pass-orientation`
- index: `1`
- status: `active`
- version: `3`

## Intent

- start_url: `https://the-internet.herokuapp.com/`
- goal: `report first feature label and total feature count from the main content list`

## Proof Contract

- collect_fields:
  - `featureCount`
  - `firstFeature`

## Success Check (authoritative)

- `featureCount >= 40 and firstFeature == "A/B Testing"`

## Example Proof Payload

```json
{
  "featureCount": 45,
  "firstFeature": "A/B Testing"
}
```
