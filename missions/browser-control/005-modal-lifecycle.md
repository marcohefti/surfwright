# Mission 005 - modal-lifecycle

## Metadata

- mission_id: `modal-lifecycle`
- index: `5`
- status: `active`
- version: `1`

## Intent

- start_url: `https://jquerymodal.com/`
- goal: `open then close modal with evidence`

## Proof Contract

- collect_fields:
  - `openSignal`
  - `closedSignal`

## Success Check (authoritative)

- `openSignal == 1 and closedSignal == 0`

## Example Proof Payload

```json
{
  "openSignal": 1,
  "closedSignal": 0
}
```

