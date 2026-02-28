# Mission 009 - infinite-scroll-chunks

## Metadata

- mission_id: `infinite-scroll-chunks`
- index: `9`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/infinite_scroll`
- goal: `scroll to load extra chunks`

## Proof Contract

- collect_fields:
  - `chunksLoaded`

## Success Check (authoritative)

- `chunksLoaded >= 2`

## Example Proof Payload

```json
{
  "chunksLoaded": 2
}
```
