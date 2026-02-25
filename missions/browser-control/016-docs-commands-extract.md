# Mission 016 - docs-commands-extract

## Metadata

- mission_id: `docs-commands-extract`
- index: `16`
- status: `active`
- version: `2`

## Intent

- start_url: `https://docs.astral.sh/uv/getting-started/installation/`
- goal: `extract installer command evidence with site-specific logic`

## Proof Contract

- collect_fields:
  - `installCommand`
  - `hasPipeSh`

## Success Check (authoritative)

- `installCommand contains "astral.sh/uv/install.sh" and hasPipeSh == true`

## Example Proof Payload

```json
{
  "installCommand": "$ curl -LsSf https://astral.sh/uv/install.sh | sh",
  "hasPipeSh": true
}
```
