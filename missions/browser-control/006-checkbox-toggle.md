# Mission 006 - checkbox-toggle

## Metadata

- mission_id: `checkbox-toggle`
- index: `6`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/checkboxes`
- goal: `toggle the first checkbox and report before/after checked state`

## Proof Contract

- collect_fields:
  - `initiallyChecked`
  - `afterToggleChecked`

## Success Check (authoritative)

- `initiallyChecked == false and afterToggleChecked == true`

## Example Proof Payload

```json
{
  "initiallyChecked": false,
  "afterToggleChecked": true
}
```
