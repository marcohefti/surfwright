# Mission 018 - infinite-scroll-chunks

## Metadata

- mission_id: `infinite-scroll-chunks`
- index: `18`
- status: `active`
- version: `1`

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

