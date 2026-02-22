# Mission 004 - first-pass-orientation

## Metadata

- mission_id: `first-pass-orientation`
- index: `4`
- status: `active`
- version: `1`

## Intent

- start_url: `https://www.w3.org/TR/WCAG22/`
- goal: `bounded first-page orientation`

## Proof Contract

- collect_fields:
  - `title`
  - `h1`
  - `headingsCount`
  - `navCount`

## Success Check (authoritative)

- `title == "Web Content Accessibility Guidelines (WCAG) 2.2" and h1 == "Web Content Accessibility Guidelines (WCAG) 2.2" and headingsCount == 8 and navCount == 10`

## Example Proof Payload

```json
{
  "title": "Web Content Accessibility Guidelines (WCAG) 2.2",
  "h1": "Web Content Accessibility Guidelines (WCAG) 2.2",
  "headingsCount": 8,
  "navCount": 10
}
```

