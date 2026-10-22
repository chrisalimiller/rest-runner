# REST Runner brand

The mark is a runner between JSON braces. Beside it, the name is set in monospace as `rest-runner` with a purple hyphen.

## Files

| File | Use |
| --- | --- |
| `brand/mark.svg` | Mark for dark backgrounds |
| `brand/mark-light-bg.svg` | Mark for light backgrounds |
| `brand/mark-mono.svg` | One color, uses `currentColor` |
| `brand/app-icon.svg`, `brand/app-icon.png` | 1024×1024 app icon tile |
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

That command also writes Android, iOS and Windows Store icons. This app ships only for macOS and Windows, so delete `src-tauri/icons/android`, `src-tauri/icons/ios`, `Square*.png`, `StoreLogo.png` and `64x64.png` afterwards.
