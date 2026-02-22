# Mission 001 - docs-install-command

## Metadata

- mission_id: `docs-install-command`
- index: `1`
- status: `active`
- version: `1`

## Intent

- start_url: `https://docs.astral.sh/uv/getting-started/installation/`
- goal: `find install command on docs page`

## Proof Contract

- collect_fields:
  - `installCommand`
  - `sourceUrl`

## Success Check (authoritative)

- `installCommand == "curl -LsSf https://astral.sh/uv/install.sh | sh" and sourceUrl == startUrl`

## Example Proof Payload

```json
{
  "installCommand": "curl -LsSf https://astral.sh/uv/install.sh | sh",
  "sourceUrl": "https://docs.astral.sh/uv/getting-started/installation/"
}
```
