# Mission 009 - infinite-scroll-chunks

## Metadata

- mission_id: `infinite-scroll-chunks`
- index: `9`
- status: `active`
- version: `4`

## Intent

- start_url: `https://the-internet.herokuapp.com/infinite_scroll`
- goal: `scroll to load additional chunks and report the resulting chunk count`

## Proof Contract

- collect_fields:
  - `chunksLoaded`
  - `loadedMore`

## Success Check (authoritative)

- `chunksLoaded >= 1 and loadedMore == true`

## Tool Usage Check (authoritative)

- `execCommand count >= 1`
- `execCommand contains "surfwright"`
- `execCommand contains any of ["target scroll-plan", "target scroll-watch", "target scroll-reveal-scan", "run --plan-json", "window.scrollTo", "scrollTo("]`

## Example Proof Payload

```json
{
  "chunksLoaded": 1,
  "loadedMore": true
}
```
