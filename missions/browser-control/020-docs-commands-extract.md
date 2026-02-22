# Mission 020 - docs-commands-extract

## Metadata

- mission_id: `docs-commands-extract`
- index: `20`
- status: `active`
- version: `1`

## Intent

- start_url: `https://docs.astral.sh/uv/getting-started/installation/`
- goal: `extract command-oriented docs items from main content`

## Proof Contract

- collect_fields:
  - `count`
  - `firstCommand`

## Success Check (authoritative)

- `count >= 10 and firstCommand == "curl"`

## Example Proof Payload

```json
{
  "count": 26,
  "firstCommand": "curl"
}
```
