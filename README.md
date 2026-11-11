# DelayCam

DelayCam is a local video replay prototype for gymnastics training. The first milestone runs in a desktop browser and tests a Logitech C922 through the browser camera API.

## Run on a PC

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open `http://127.0.0.1:5173` in Chrome or Edge, connect the C922, and allow camera access. The prototype requests 1920x1080 at up to 60 fps. The actual resolution and frame rate are shown below the preview because the camera and driver may negotiate a different mode.

The current browser prototype:

- keeps a local 30-second preview buffer;
- displays a configurable 0-30 second delayed feed;
- lets the operator select a video input;
- supports freeze, stop, reconnect, and fullscreen;
- uses a fullscreen tablet-first preview; tap the preview to show or hide the controls;
- keeps video processing local in the browser.

The first buffer implementation samples a scaled preview at 15 fps. It is intended to validate the workflow and delay feel, not yet to be the final 1080p60 engine.

## Build a portable Windows app

```bash
npm run dist:win
```

The portable executable is written to `release/DelayCam-0.0.1-portable.exe`. Copy that single file to another 64-bit Windows PC and run it there. No Node.js installation is required on the target PC. Windows may show a SmartScreen warning for locally built unsigned applications; the executable is not code-signed yet.

For the fastest startup, use the folder build with `npm run dist:win:folder`. Copy the complete `release/win-unpacked/` folder and start `release/win-unpacked/DelayCam.exe`; the executable must stay together with the other files in that folder.

The packaged app loads the frontend locally and requests access to USB cameras through Electron's media permission handler. Windows camera privacy settings still need to allow desktop apps to use the camera.

## Validation

```bash
npm run lint
npm run build
```

## iPhone / iPad (web app)

The same React app is published as an offline-capable web app (PWA) on GitHub Pages:

**https://welander071290.github.io/delaycam/**

1. Open the address in **Safari** (needs internet the first time).
2. Tap **Share → Add to Home Screen** and always start DelayCam from that icon.
3. Allow camera access. The back camera is used by default; other cameras (front, ultra wide) can be chosen under *Camera*.

Differences from the Windows app:

- Defaults to 720p / 30 fps, and the frame buffer is capped at about 220 MB so Safari does not close the app. If *buffered* stays below the chosen delay, select a lower quality.
- The screen is kept on while the camera runs (Wake Lock, iOS 18.4+).
- iOS stops the camera when the app goes to the background; DelayCam restarts it when you return (the buffer starts over).
- Rotating the phone is supported; the picture follows the camera orientation.
- *Full screen* is only shown where the browser supports it, and *Close* only in the Windows app.

Camera access in Safari requires https, so the app cannot be tested on the iPhone over plain `http://<pc-ip>:5173`. Test layout locally with `npm run dev` and open `http://127.0.0.1:5173/pwa/iphone15.html` (iPhone 15 frame, portrait/landscape).

### Publish a new version

```bash
npm run build:web          # builds into docs/ incl. sw.js (offline cache)
git add -A
git commit -m "Describe the change"
git push
```

GitHub Pages serves the `docs/` folder of the `main` branch. Installed apps load the cached version instantly, fetch the new one in the background and show *New version ready – tap to update*. Allow up to ~10 minutes for GitHub's cache.

## Cross-platform direction

The React UI and delay model can be reused for a packaged Windows build and for the Android tablet UI. Android USB cameras are the platform-specific part: an Android package will need a native UVC/USB-host adapter instead of relying on the browser camera API. The adapter can expose the same camera stream interface used by this prototype.

Planned next steps:

1. Measure the C922 at 1080p60 and 720p60 on the actual PC.
2. Replace preview-frame sampling with an encoded circular video buffer.
3. Add a Windows packaged target.
4. Add and test the Android UVC adapter with the selected tablet and powered USB-C hub.
# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
