# Arena empty-reply and send confirmation fix

Changed `featherscript-extension/providers/arena.js`:

- Read both chronological and reverse-column transcripts in chronological order.
- Accept actual message bodies without requiring the cosmetic mx-auto class.
- Recognize semantic user-role attributes and message-content attributes.
- Prefer stable message IDs through DOM remounts; avoid relying on increasing visible counts.
- Find the real form submit control when its accessible label is absent; exclude known Stop controls.
- Wait for a usable send control, then click once and require a cleared composer, new turn or generation signal. A send that is not confirmed raises an explicit error and preserves its draft instead of triggering a misleading empty-response recovery.
- Keep image-upload failures explicit; never claim the image was sent when staging failed.

Validation: real Chromium DOM fixtures cover both transcript orders, class-free turns, reading the newest complete reply, stable remount identity, unlabeled submit fallback, one confirmed send, and a rejected send preserving its draft without repeated clicks. All 12 provider contracts, send-loop regressions, shared DOM tests and parser tests pass. Authenticated live Arena remains unverified.

Your screenshot shows the old v2.0.0 toolbar (RS/AS buttons). This update is in:
C:\Users\Admin\Downloads\FeatherScript-2.0.1 (1)\FeatherScript-2.0.1\featherscript-extension

In chrome://extensions (or your browser's extension manager), check the unpacked extension is loaded from that directory, click Reload, then refresh Arena. If it points at an older extracted copy, load the directory above instead. The current toolbar has named RobloxScript/AgentScript profiles and a skill-library indicator. Rebuilding a ZIP alone does not update an extension already loaded from a different directory.
