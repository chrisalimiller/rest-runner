# REST Runner brand

The mark is a runner between JSON braces. Beside it, the name is set in monospace as `rest-runner` with a purple hyphen.

## Files

| File | Use |
| --- | --- |
| `brand/mark.svg` | Mark for dark backgrounds |
| `brand/mark-light-bg.svg` | Mark for light backgrounds |
| `brand/mark-mono.svg` | One color, uses `currentColor` |
| `brand/app-icon.svg`, `brand/app-icon.png` | 1024×1024 app icon tile, full bleed (Windows) |
| `brand/app-icon-macos.svg`, `brand/app-icon-macos.png` | Same tile at 824×824 centered on a clear 1024×1024 canvas (macOS) |
| `src/components/BrandMark.tsx` | `BrandMark` and `BrandLockup` (top bar) for the app |

## Colors

- `--brand: #bc8cff` for braces, the hyphen and accents.
- `--brand-strong: #8957e5` for solid fills.
- The runner uses `--text` (`#e6edf3`), or white on the app icon.
- Keep the brand purple separate from the PATCH method color (`#a371f7`).

## Rules

- Keep the 4:3 ratio (viewBox `0 0 64 48`, stroke 3.4, round caps and joins).
- Don't color the runner purple.
- In the UI, use the mark at least 20px tall. For anything smaller, use the app icon.

## App icons

After changing `brand/app-icon.png`, regenerate the desktop icons and commit the output:

```sh
npm run tauri icon brand/app-icon.png
```

Then rebuild the macOS icon from the padded source and keep only its `icon.icns`:

```sh
npm run tauri icon brand/app-icon-macos.png -- -o /tmp/mac-icons
cp /tmp/mac-icons/icon.icns src-tauri/icons/icon.icns
```

macOS doesn't add a margin around app icons. Apple's grid puts the tile at 824×824 with about 100px clear on each side, so a full-bleed `icon.icns` looks about 20% bigger than other apps in the Dock and Cmd+Tab. Windows icons stay full bleed. If you change `app-icon.svg`, update `app-icon-macos.svg` too: it wraps the same content in `translate(100 100) scale(0.8046875)`.

The first command also writes Android, iOS and Windows Store icons. This app ships only for macOS and Windows, so delete `src-tauri/icons/android`, `src-tauri/icons/ios`, `Square*.png`, `StoreLogo.png` and `64x64.png` afterwards.
