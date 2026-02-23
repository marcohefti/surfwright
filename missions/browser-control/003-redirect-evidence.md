# Mission 003 - redirect-evidence

## Metadata

- mission_id: `redirect-evidence`
- index: `3`
- status: `active`
- version: `1`

## Intent

- start_url: `https://github.com/marcohefti`
- goal: `find profile homepage, open it, then report blog URL from the homepage`

## Proof Contract

- collect_fields:
  - `profileHomepage`
  - `blogUrl`

## Success Check (authoritative)

- `profileHomepage is non-empty and blogUrl == "https://blog.heftiweb.ch"`

## Example Proof Payload

```json
{
  "profileHomepage": "https://heftiweb.ch",
  "blogUrl": "https://blog.heftiweb.ch"
}
```
