# Mission 007 - file-upload

## Metadata

- mission_id: `file-upload`
- index: `7`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/upload`
- goal: `create a local file named upload-proof.txt, upload it, and verify uploaded filename`

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
