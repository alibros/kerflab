# Security policy

KerfLab is a static, browser-only app: there is no backend, no accounts and no data leaves your
browser (designs live in the URL and in local storage). The attack surface is small, but if you
find something (for example a crafted share link that runs script, or a malicious SVG/DXF export),
we'd like to hear about it.

## Reporting a vulnerability

Please **don't** open a public issue for security problems. Instead, use GitHub's
[private vulnerability reporting](../../security/advisories/new) on this repository, or contact
the maintainer, Ali Bross, via https://forestofrods.com.

Include what you found, how to reproduce it (a share link is perfect) and the browser you used.
You'll get an acknowledgement within a week. This is a volunteer project, so fixes land on a
best-effort basis; we'll credit you in the release notes unless you'd rather we didn't.

## Supported versions

Only the latest version on the default branch (and the deployed site built from it) is supported.
