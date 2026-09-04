# Security

WordSnap runs in your browser and sends the draft you choose to analyze to the LLM provider you configured, from your own account. There is no WordSnap server. The properties that make it safe to use are listed under "Invariants" in [CLAUDE.md](./CLAUDE.md): the API key never reaches a page context, nothing is written into the host editor except on Apply, findings are display-only, and a cited URL must appear in that request's search results or it is dropped.

## Reporting a vulnerability

Report privately through [GitHub security advisories](https://github.com/jalemieux/wordsnap/security/advisories/new). Do not open a public issue for something exploitable.

Include the extension version (chrome://extensions), the site you were on, the provider in use, and the `[wordsnap]` lines from the page console and the service worker console. A minimal draft that reproduces the problem helps most.

You will get an acknowledgement within a few days. Fixes ship as a new version on the Chrome Web Store and a tagged release here. There is no bug bounty.

## Scope

In scope: anything that lets a web page read the API key, lets page content or a model response write into the editor or trigger an action without a click, lets a finding cite a URL that was not in the search results, or sends text anywhere other than the configured provider.

Out of scope: the behavior of the providers themselves, and findings that are merely wrong. Wrong findings are a quality issue; open a normal issue for those.
