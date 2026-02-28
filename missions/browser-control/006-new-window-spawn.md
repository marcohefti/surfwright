# Mission 006 - new-window-spawn

## Metadata

- mission_id: `new-window-spawn`
- index: `6`
- status: `active`
- version: `2`

## Intent

- start_url: `https://the-internet.herokuapp.com/windows`
- goal: `open child target and verify child page`

## Proof Contract

- collect_fields:
  - `spawnUrl`
  - `spawnTitle`
  - `pageUrl`
  - `pageTitle`
  - `pageH3`

## Success Check (authoritative)

- `spawnUrl == "https://the-internet.herokuapp.com/windows/new" and spawnTitle == "New Window" and pageUrl == "https://the-internet.herokuapp.com/windows/new" and pageTitle == "New Window" and pageH3 == "New Window"`

## Example Proof Payload

```json
{
  "spawnUrl": "https://the-internet.herokuapp.com/windows/new",
  "spawnTitle": "New Window",
  "pageUrl": "https://the-internet.herokuapp.com/windows/new",
  "pageTitle": "New Window",
  "pageH3": "New Window"
}
```
