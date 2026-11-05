# Appearance and interface polish

The existing sidebar, tabs, layout, typography, presets, music and sound controls
are retained. Transition polish prevents stacked heading animations and premature
dialog hiding, and respects both system reduced motion and the Feel controls.

## Your own colors and backgrounds

1. Open **Settings → Appearance → Make your own palette & background**.
2. Choose accent, canvas, surface and text colors. Select a solid canvas,
   two-color gradient, or a local photo. Adjust gradient direction or background
   dimming, and enable **Use my design** to preview it on the desktop workspace.
3. Select **Save my design**. The design is saved with the active local profile.

Photos accept PNG, JPEG and WebP up to 12 MB. They are resized to at most 1600
pixels on the longest edge and converted to a bounded JPEG. They are saved on
this computer, not uploaded or included in release ZIPs. SVG images and remote
background URLs are not accepted. The contrast indicator helps distinguish text
from the chosen surface; action-button text automatically uses a contrasting color.

Selecting one of the existing 21 presets disables the custom appearance while
retaining its values for later. **Reset to preset** resets the preview; select
**Save my design** to persist the reset. Desktop photos and custom palettes do
not change the browser provider page or the extension's preset theme settings.

## Verification

Local tests cover palette validation, image bounds, browser/main-process parity,
profile-targeted persistence and all existing app/provider/bridge regressions.
Isolated Chromium checks cover the original sidebar layout, rapid navigation,
live palettes, photo import, switching profiles, reload persistence, reset,
responsive layouts and reduced motion. Test profiles and images are kept outside
the application release. Authenticated provider sessions require live verification.
