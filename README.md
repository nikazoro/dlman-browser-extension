# DLMan Browser Extension

An independently maintained Chrome/Brave browser extension for [DLMan](https://github.com/novincode/dlman). It intercepts configured browser downloads and sends them to the DLMan desktop application for queueing, resumable transfers, and download management.

> **Fixed community edition:** Use the releases from this repository if you need the corrected extension. This edition fixes disabled-site bypasses, site-rule normalization, stale settings, and File Pattern/MIME interception bugs. It is not an official upstream DLMan release.

**[Download the latest fixed release](../../releases/latest)** · **[View all releases](../../releases)**

This repository contains the browser-extension package only. It is intentionally separate from the upstream DLMan monorepo and is not the full desktop application.

## Why this repository exists

This repository was created to provide a corrected, independently maintained extension package. The original upstream extension contained several serious behavioral problems that made its settings unreliable in real browsing sessions:

- **Disabled sites could still be intercepted.** The disabled-site check was incomplete, used inconsistent URL/hostname handling, and could be bypassed by context-menu downloads, batch links, media requests, redirects, and other service-worker paths.
- **Site rules were not normalized consistently.** Full resource URLs, paths, query strings, fragments, ports, and inconsistent `www`/subdomain forms could be treated as site rules instead of domain rules. The extension also had no consistent compatibility path for legacy whitelist-style values.
- **File Patterns could be ignored.** A hardcoded MIME-type allowlist could cause files such as PDFs to be intercepted even after `pdf` had been removed from File Patterns.
- **Settings could become stale or inconsistent.** Popup/options state, `chrome.storage.local`, and the background service worker did not always share the same normalized configuration.
- **Rule logic was duplicated across runtime surfaces.** Popup, content-script, and background checks did not consistently apply the same site and file matching semantics.

This project centralizes those rules and enforces them in the MV3 service-worker path. It is intended as a practical maintenance and bug-fix distribution for users who need predictable Chrome/Brave behavior. It is not an official upstream release, and changes here should not be assumed to be merged into or supported by the upstream project.

## Supported browsers

- Google Chrome
- Brave
- Chromium-based browsers that support Manifest V3

The current package uses a Manifest V3 service worker and Chromium extension APIs. Firefox-specific packaging is not the target of this repository.

## Requirements

- The DLMan desktop application must be installed and running.
- The default local integration port is `7899`; it can be changed in the extension settings and must match the desktop application.

## Installation from a release

1. Download the latest release archive from this repository.
2. Extract the archive to a permanent local directory.
3. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted extension directory.
6. Start the DLMan desktop application.

## Configuration

Open the extension popup and choose **Settings**.

- **Auto-Intercept Downloads** controls automatic interception.
- **File Patterns** controls which file types the extension downloads.
- **Disabled Sites** prevents the extension from managing downloads for the configured hostname or domain pattern. URL paths, query strings, fragments, and ports are not stored as site rules.
- When a file does not match the configured patterns, the browser is allowed to download it normally; the extension does not block it.

## Troubleshooting

If a download is not sent to DLMan:

1. Confirm that the desktop application is running.
2. Confirm that the extension and desktop application use the same port.
3. Confirm that **Auto-Intercept Downloads** is enabled.
4. Confirm that the file matches a configured File Pattern.
5. Confirm that the site is not listed under **Disabled Sites**.

If settings appear stale, reload the extension from the browser extensions page and reopen the settings page.

## Relationship to upstream DLMan

This project is a standalone browser-extension repository based on the extension component of [novincode/dlman](https://github.com/novincode/dlman/tree/main/apps/extension). It is maintained and distributed independently so extension-specific fixes and releases can be published without mirroring the entire desktop application repository.

Please review the upstream project for the desktop application's source, releases, documentation, and contribution guidance.

## License

This project is distributed under the [MIT License](LICENSE). It retains the upstream DLMan attribution required by that license.
