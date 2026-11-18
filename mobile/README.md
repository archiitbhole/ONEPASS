# ONEPASS — mobile

A native client for the one thing a browser cannot do.

## Why this is small

The ONEPASS web app is already an installable PWA: it has a manifest, generated
icons, a service worker that keeps the pass working offline, and a consumer
surface of two dozen screens. Rebuilding that surface natively would duplicate
every screen, every query and every bug, and would need updating twice on every
API change.

So this app is scoped to what a browser genuinely cannot reach: holding a
credential against a contactless reader. It signs in and shows the rotating
pass. Everything else stays in the web app, where it already works.

## What it talks to

The same API the web app uses — `POST /api/auth/sign-in`, `GET /api/me`,
`GET /api/me/pass` — with the same opaque httpOnly session cookie. There is no
second backend and no second auth scheme.

Point it at a host with `EXPO_PUBLIC_API_URL`:

```bash
EXPO_PUBLIC_API_URL=https://your-onepass-host npx expo start
```

The default is `http://10.0.2.2:3000`, the Android emulator's alias for the
host machine.

## The QR code

Imported from `@onepass/pass/qr` — a file dependency on the same package the web
app uses, so there is exactly one QR implementation in this repository. The
encoder has no dependencies, which is why it can cross to a phone; the TOTP
helpers in the same package import `node:crypto` and stay on the server.

`metro.config.js` points Metro at that folder, because npm installs a file
dependency as a symlink out of the project root and Metro does not follow one by
default.

## What is verified, and what is not

Verified here:

- `npm run typecheck` — clean.
- `npx expo export --platform android` — bundles, 583 modules, 1.5 MB Hermes bytecode.
- `npx expo export --platform web` — bundles, and the sign-in screen was rendered
  in a browser at a phone viewport with no console errors.

**Not verified, and not claimed:**

- **No device or emulator build has been made.** This environment has no Android
  SDK and no Xcode, so `expo run:android` / `run:ios` have never executed. The JS
  bundles; the native shell is unproven.
- **No store submission has been made**, to either store, and none is claimed.
- **NFC is not implemented.** No NFC module is installed and nothing here reads
  or emulates a tag. It is named as the reason this app exists rather than
  stubbed, because a stub that reports a successful tap would be worse than an
  absence.
- Sign-in cannot be exercised from a browser build: the API refuses a
  cross-origin write, and a browser will not let a page set its own `Origin`.
  React Native's networking stack is not a browser and is not subject to that,
  which is why the client sets the header.

## Next steps for a real release

1. `npx expo run:android` on a machine with the Android SDK, to prove the shell.
2. Add an NFC module and implement the tap, on hardware.
3. EAS credentials, then a build, then a store listing — in that order.
