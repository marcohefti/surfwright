# Mission 002 - modal-lifecycle

## Metadata

- mission_id: `modal-lifecycle`
- index: `2`
- status: `active`
- version: `1`

## Intent

- start_url: `https://www.jquerymodal.com/`
- goal: `open Example 6 first modal, click through to third modal, and report third modal text`

## Proof Contract

- collect_fields:
  - `thirdModalText`

## Success Check (authoritative)

- `thirdModalText == "I'm the third modal. You get the idea."`

## Example Proof Payload

```json
{
  "thirdModalText": "I'm the third modal. You get the idea."
}
```
