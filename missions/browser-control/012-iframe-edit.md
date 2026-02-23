# Mission 012 - iframe-edit

## Metadata

- mission_id: `iframe-edit`
- index: `12`
- status: `active`
- version: `1`

## Intent

- start_url: `https://www.w3schools.com/html/tryit.asp?filename=tryhtml_iframe_height_width`
- goal: `from rendered output, report text displayed inside the iframe`

## Proof Contract

- collect_fields:
  - `iframeText`

## Success Check (authoritative)

- `iframeText == "This page is displayed in an iframe"`

## Example Proof Payload

```json
{
  "iframeText": "This page is displayed in an iframe"
}
```
