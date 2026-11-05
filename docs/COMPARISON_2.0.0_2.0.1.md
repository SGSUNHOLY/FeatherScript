# 2.0.0 versus 2.0.1 release comparison

Compared the two ZIPs supplied locally, without executing the 2.0.0 release.

| Archive | SHA-256 | Files |
| --- | --- | --- |
| FeatherScript-2.0.0.zip | b1a6ceb8a0ff4d346dfdd3645cec874ce24349670b07cd1a5dc2ff950634a23d | 72 |
| FeatherScript-2.0.1 (1).zip | 8d7b569ea6e095893e4a1d9800c006ddcbd1f1e95df29ada8fdcfc70bfafa1c9 | 394 |

## Findings

- 2.0.0 already contains the remotely styled promotional banner previously
  identified by Triage, as well as the automatic npm installer hook. Their
  presence alone cannot explain why the reported verdicts differ. Removing the
  banner was an asset cleanup; the other hardening changes are not a proven
  explanation of the antivirus finding.
- The supplied 2.0.1 ZIP no longer contains the flagged `assets/banner.svg`.
  Its hash differs from the earlier report. That older report cannot establish
  the detection status of the newer archive.
- Neither supplied ZIP bundles native EXE/DLL files. Both lock Electron to
  the same installed package version, 45.2.1; 2.0.1 makes the dependency
  declaration exact and disables npm lifecycle scripts during bootstrap.
- The largest addition is optional skill/development tooling: Python programs,
  a Windows desktop frame-capture PowerShell helper, cloud asset workflows and
  local development servers. These are not required by the desktop UI, provider
  adapters, Obsidian integration or headless Blender controller. Their presence
  is not by itself evidence of malware, and they were not executed for this review.

## Default-package changes

The Lite packager now includes exactly the five skill families shipped in
2.0.0, preserving their original files. Optional development toolkits remain
in the source tree and can be imported deliberately. Packaging neither installs
nor deletes the user's existing optional skills. The current providers, themes,
local profiles, vault integration and headless Blender remain in the application.

Regression tests enforce this boundary. The archive also retains the previous
hardening: no forced termination of competing programs, no antivirus exclusions,
embedded download checksums, passive SVG validation, and per-file hashes.

## Verification limit

No matching new antivirus finding or successful current antivirus scan is
available for the supplied 2.0.1 archive. Source comparison and functional tests
cannot prove a malware-free verdict or guarantee zero false positives. The
rebuilt archive must be scanned under its new SHA-256 to verify the result.
