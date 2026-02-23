# Mission 002 - homepage-pricing

## Metadata

- mission_id: `homepage-pricing`
- index: `2`
- status: `active`
- version: `1`

## Intent

- start_url: `https://github.com`
- goal: `navigate to pricing and report whether Free plan includes standard support`

## Proof Contract

- collect_fields:
  - `finalUrl`
  - `freePlanStandardSupport`

## Success Check (authoritative)

- `finalUrl == "https://github.com/pricing" and freePlanStandardSupport == false`

## Example Proof Payload

```json
{
  "finalUrl": "https://github.com/pricing",
  "freePlanStandardSupport": false
}
```
