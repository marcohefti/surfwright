# Mission 010 - download-file

## Metadata

- mission_id: `download-file`
- index: `10`
- status: `active`
- version: `3`

## Intent

- start_url: `https://the-internet.herokuapp.com/download`
- goal: `trigger first download link and verify download metadata`

## Proof Contract

- collect_fields:
  - `downloadStarted`
  - `downloadStatus`
  - `downloadFinalUrl`
  - `downloadFileName`

## Success Check (authoritative)

- `downloadStarted == true and downloadStatus is non-empty and downloadFinalUrl starts with https://the-internet.herokuapp.com/download/ and downloadFileName is non-empty`

## Example Proof Payload

```json
{
  "downloadStarted": true,
  "downloadStatus": "completed",
  "downloadFinalUrl": "https://the-internet.herokuapp.com/download/some-file.txt",
  "downloadFileName": "some-file.txt"
}
```
