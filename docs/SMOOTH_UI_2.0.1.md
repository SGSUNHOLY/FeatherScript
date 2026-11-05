# Smooth UI update

Changes are applied to both desktop and extension. Desktop surfaces now share short opacity/transform transitions, restrained hover lift, press feedback, stable scroll gutters and lighter layout crossfades. Page-level entrance motion replaces stacked card entrances. The extension has matching press and Cowork panel feedback.

VFX simulation/drawing is capped at 30fps during idle ambience and 60fps during active bursts/rings or recent pointer motion. Canvas resolution uses a three-megapixel budget with a 1.5 DPR ceiling; this affects background particles, not text/UI resolution. Pointer spotlight writes are coalesced to animation frames. Background particle work stops when unfocused/hidden. Decorative extension animations pause when the tab is hidden, while agent execution continues.

Nested panel blur and the extension controller's redundant backdrop sampling are removed. The desktop's native acrylic/window blur, translucent panels and glass surfaces remain. Motion Off and operating-system reduced motion are respected. Only looping ambience is paused on desktop blur; finite entrance animations finish so an unfocused window cannot remain transparent.

Validation: renderer-feel, layout-transition, renderer-assets and all twelve provider contracts passed. Chromium checks cover surface transitions, scrolling, Motion Off and reduced motion; a rendered app screenshot was inspected. Earlier full-core task orchestration scenarios passed; the current single-pipeline checks are recorded in the latest verification report. A deterministic 144 Hz scheduler test observed 30 idle draws per second and at most 64 active draws per second including boundary allowance; it also verifies the pixel budget, inactivity, hidden and destroy cleanup. These are scheduling/behavior tests, not a hardware performance benchmark or a zero-lag guarantee.

Restart the desktop app, reload the unpacked extension from this folder and refresh chat tabs to apply the update.
