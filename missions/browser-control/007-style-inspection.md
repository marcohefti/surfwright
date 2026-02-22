# Mission 007 - style-inspection

## Metadata

- mission_id: `style-inspection`
- index: `7`
- status: `active`
- version: `1`

## Intent

- start_url: `https://getbootstrap.com/docs/5.3/components/buttons/`
- goal: `read computed style fields of primary button`

## Proof Contract

- collect_fields:
  - `found`
  - `targetText`
  - `styleBg`
  - `styleColor`
  - `styleFontSize`
  - `styleRadius`

## Success Check (authoritative)

- `found == true and targetText == "Primary" and styleBg == "rgb(13, 110, 253)" and styleColor == "rgb(255, 255, 255)" and styleFontSize == "16px" and styleRadius == "6px"`

## Example Proof Payload

```json
{
  "found": true,
  "targetText": "Primary",
  "styleBg": "rgb(13, 110, 253)",
  "styleColor": "rgb(255, 255, 255)",
  "styleFontSize": "16px",
  "styleRadius": "6px"
}
```

