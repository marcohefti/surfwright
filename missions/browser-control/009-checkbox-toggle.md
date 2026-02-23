# Mission 009 - checkbox-toggle

## Metadata

- mission_id: `checkbox-toggle`
- index: `9`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/shifting_content`
- goal: `open Example 2 and return absolute src URL of the rendered image`

## Proof Contract

- collect_fields:
  - `imageSrc`

## Success Check (authoritative)

- `imageSrc == "https://the-internet.herokuapp.com/img/avatar.jpg"`

## Example Proof Payload

```json
{
  "imageSrc": "https://the-internet.herokuapp.com/img/avatar.jpg"
}
```
