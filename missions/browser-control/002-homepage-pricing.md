# Mission 002 - homepage-pricing

## Metadata

- mission_id: `homepage-pricing`
- index: `2`
- status: `active`
- version: `1`

## Intent

- start_url: `https://github.com`
- goal: `navigate to pricing from homepage`

## Proof Contract

- collect_fields:
  - `finalUrl`
  - `finalTitle`
  - `pricingPageOk`

## Success Check (authoritative)

- `finalUrl == "https://github.com/pricing" and finalTitle == "Pricing · Plans for every developer · GitHub" and pricingPageOk == true`

## Example Proof Payload

```json
{
  "finalUrl": "https://github.com/pricing",
  "finalTitle": "Pricing · Plans for every developer · GitHub",
  "pricingPageOk": true
}
```

