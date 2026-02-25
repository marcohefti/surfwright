# Mission 015 - download-file

## Metadata

- mission_id: `download-file`
- index: `15`
- status: `active`
- version: `1`

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

- `downloadStarted == true and downloadStatus == 200 and downloadFinalUrl starts with https://the-internet.herokuapp.com/download/ and downloadFileName is non-empty`

## Example Proof Payload

```json
{
  "downloadStarted": true,
  "downloadStatus": 200,
  "downloadFinalUrl": "https://the-internet.herokuapp.com/download/some-file.txt",
  "downloadFileName": "some-file.txt"
}
```

