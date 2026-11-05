# Extension music

The extension includes an original 33.6-second ambient loop based on the desktop
app's Dmaj7 / Bm7 / Gmaj7 / A7sus4 palette. It is bundled locally as PCM audio;
playback does not download tracks or contact an audio service.

## Controls

- Popup: use Play/Pause and Volume in the Ambient music card.
- Dashboard: the same controls are in Settings.
- Chat controller: the ♫ shortcut plays or pauses the same player.
- The separate sound-effects switch controls short interface cues. It is shared
  across extension surfaces and does not mute ambient music.

Music is paused by default and only starts after a Play action. A single offscreen
document owns playback, so closing the popup or opening several supported chat
tabs does not create multiple tracks. Pause closes that player and releases its
resources. Browser restart requires another Play action. Saved volume and mute
settings survive restart. Desktop-app music has its own settings.

The implementation uses Chrome/Edge's offscreen API and runtime.getContexts
(Chrome 116+). The offscreen permission is declared in the manifest. The official
[offscreen API documentation](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
describes the AUDIO_PLAYBACK lifecycle, including closing a silent player after
30 seconds. Raising volume or returning to the extension refreshes player state;
press Play again if the browser released the silent document.

## Troubleshooting

Reload the unpacked extension and refresh existing chat tabs after this update.
If Play fails, the popup/dashboard shows the playback error instead of claiming
the track is playing. Check the volume slider, browser audio mute, system mixer
and output device. Update Chrome/Edge if offscreen playback is unsupported.
The bridge and Roblox Studio are not needed to play the extension's music.
