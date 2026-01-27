# Holon UI (Phase 4)

React + React Flow UI.

- Runs inside the VS Code extension webview (production path)
- Can also run in a normal browser with Vite hot reload (dev path)

## Dev

- `npm install`
- `npm run dev`

### Browser hot reload (recommended)

Run the Python dev API (serves parse/patch endpoints):

- `cd core && poetry run python -m holon.devserver --file core/examples/demo.holon.py`

Then run Vite:

- `cd ui && npm run dev`

Open the printed Vite URL (usually `http://localhost:5173`). The UI will talk to the Python devserver via `/api/*`.

## Build for the extension

- `npm run build`

The extension loads the static assets from `ui/dist`.
