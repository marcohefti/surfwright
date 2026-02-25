# Mission 003 - multimatch-disambiguation

## Metadata

- mission_id: `multimatch-disambiguation`
- index: `3`
- status: `active`
- version: `1`

## Intent

- start_url: `https://the-internet.herokuapp.com/jqueryui/menu#`
- goal: `hover Enabled then Downloads and report visible submenu entries under Downloads`

## Proof Contract

- collect_fields:
  - `downloadsItems`

## Success Check (authoritative)

- `downloadsItems == "PDF, CSV, Excel"`

## Example Proof Payload

```json
{
  "downloadsItems": "PDF, CSV, Excel"
}
```
