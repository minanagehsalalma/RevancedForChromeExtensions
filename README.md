# extpatcher

extpatcher is a CLI tool that creates portable patch bundles for unpacked Chrome extensions. Given an original folder and a modified folder, it produces a zip patch bundle you can apply later to reproduce the modified version exactly.

## Requirements

- Node.js 20 or newer
- npm

## Install

```bash
git clone <your-repo-url>
cd extpatcher
npm install
```

## Build

```bash
npm run build
```

The CLI runs from `dist/`, so build once before using `npm start`.

## Quick start

```bash
# Create a patch bundle
npm start -- make --original ./Original --modified ./Modified --out ./patch-bundle.zip

# Apply a patch bundle to a directory
npm start -- apply --patch ./patch-bundle.zip --in ./Original --out ./Patched

# Apply a patch bundle to a zip
npm start -- apply --patch ./patch-bundle.zip --in ./Original.zip --out ./Patched.zip

# Verify an input against a patch bundle
npm start -- verify --patch ./patch-bundle.zip --in ./Original
```

## Example (Cookie Editor in this repo)

```bash
npm run build
npm start -- make --original ./Original --modified ./Modified --out ./cookie-editor.patch.zip
npm start -- apply --patch ./cookie-editor.patch.zip --in ./Original --out ./Patched --check-against ./Modified
```

## Tests

```bash
npm test
```

## Notes

- Patch bundles contain `patch.json` plus a `payload/` folder with replacement file bytes.
- Patched extensions cannot remain installed via the Chrome Web Store. Chrome will treat them as unpacked extensions; you must load them in Developer Mode.
