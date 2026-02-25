# Mission 011 - file-upload

## Metadata

- mission_id: `file-upload`
- index: `11`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/upload`
- goal: `upload fixture file and verify uploaded filename`

## Proof Contract

- collect_fields:
  - `uploadedFile`

## Success Check (authoritative)

- `uploadedFile == "upload-proof.txt"`

## Example Proof Payload

```json
{
  "uploadedFile": "upload-proof.txt"
}
```

