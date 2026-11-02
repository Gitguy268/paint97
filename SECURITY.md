# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue.

Use GitHub's private reporting form: <https://github.com/Gitguy268/win97-excalidraw/security/advisories/new>

Include what you found, how to reproduce it, and the browser and version you used. You should get a reply within a week. Please give the fix time to ship before you publish details.

## Scope

Everything runs in the browser. There is no backend, no account and no analytics; drawings, notes and settings stay in the browser's own storage. The README's [Security and privacy](README.md#security-and-privacy) section describes the content security policy. The most useful reports are about:

- an imported scene, share link or backup file that runs script or breaks out of the size and shape checks;
- anything that makes the page send data off the device;
- a way around the SHA-256 check on the model parts;
- the GitHub Actions workflows in this repository.

## Supported versions

Only the latest version on the `main` branch is supported.
