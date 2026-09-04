# Chrome Web Store listing

Everything the developer dashboard asks for, in the order it asks. Paste from here. Keep this file in sync with the manifest when permissions change; the privacy tab answers are checked at review.

Package: `cd extension && npm run package` produces `wordsnap-<version>.zip`. Screenshots: `store/screenshots/` (1280x800).

## Store listing tab

**Name** (45 chars max shown in the store): `WordSnap`

**Summary** (132 chars max):

> Sharpen your own argument before you send it. Clarity, fact check and counterargument passes over your draft, in place, in your voice.

**Description:**

> WordSnap sits on top of the compose window you are already typing in and runs three passes over your draft:
>
> Clarity and claims. Fuzzy thinking, hedges, weak structure, and every checkable claim you made.
>
> Fact check. Each claim verified with web search: supported, contradicted, or needs precision, with sources and a tighter wording when one exists.
>
> Counterargument. The thesis as a reader will hear it, then the strongest rebuttal, the blind spots, and the gaps.
>
> Your words stay in the editor. WordSnap draws highlights over them and shows a docked panel of challenges. It writes into the editor only when you click Apply change, and a suggestion may only replace the quoted span and must keep your register. It is a sparring partner, not a ghostwriter.
>
> Quiet by default. A small badge appears on a compose window in Gmail, X or LinkedIn. Nothing is sent anywhere until you click it.
>
> Your text goes only to the LLM provider you configure, from your own account. OpenRouter connects with one click; an Anthropic API key also works. There is no WordSnap server, no account, no analytics.
>
> Open source under Apache-2.0: https://github.com/jalemieux/wordsnap

**Category:** Productivity → Workflow & Planning

**Language:** English

**Store icon:** `extension/public/icons/icon-128.png`

**Screenshots (1280x800, 1 to 5):** `store/screenshots/01-badge.png`, `02-analyzing.png`, `03-panel.png`, `04-hover.png`, `05-settings.png`

**Small promo tile (440x280):** `store/promo-440x280.png`

**Official URL:** https://wordsnap.ai (needs site verification in Search Console under the same Google account)

**Homepage URL:** https://wordsnap.ai

**Support URL:** https://github.com/jalemieux/wordsnap/issues

## Privacy tab

**Single purpose description:**

> Analyzes the draft in the compose window the user is writing in and shows clarity, fact-check and counterargument findings over it. It writes into the draft only when the user clicks Apply on a specific suggestion.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Stores the user's settings and provider key locally (`chrome.storage.local`), and a 24 hour cache of claim verdicts so unchanged claims are not re-verified. |
| `activeTab` | When the user clicks the toolbar icon on a site that is not Gmail, X or LinkedIn, the extension needs the current tab to attach to the composer on that page. Used only on click. |
| `identity` | `chrome.identity.launchWebAuthFlow` performs the one-click OpenRouter sign-in (OAuth PKCE). No Google account data is read. |
| `scripting` | Injects the content script into the current tab when the user clicks the toolbar icon on a site outside the built-in list. Never runs without that click. |
| Host: `mail.google.com`, `x.com`, `twitter.com`, `www.linkedin.com` | The three supported composers. The content script reads the draft the user is writing and draws the overlay over it. |
| Host: `openrouter.ai`, `api.anthropic.com` | The two LLM providers the user can configure. The background sends the draft there for analysis. |
| Optional host: `https://*/*` | Requested only when the user clicks the toolbar icon on another site, so the generic composer adapter can run there. |

**Remote code:** No. All code ships in the package.

**Data usage, what the extension collects or transmits:**

- [x] Personal communications: the text of the email or post the user is drafting, sent to the provider the user configured for analysis.
- [x] Website content: the draft text read from the compose window. Same data as above.
- [x] Authentication information: the provider API key, stored locally on the device only. It is sent only to that provider's API.
- [ ] Personally identifiable information
- [ ] Health information
- [ ] Financial and payment information
- [ ] Location
- [ ] Web history
- [ ] User activity

**Certifications:**

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases.
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://wordsnap.ai/privacy.html

## Distribution tab

**Visibility:** Unlisted for the first submission. Flip to Public after a week on the store build.

**Regions:** All.

**Payments:** Free.

## Account (one time)

- Developer registration fee $5, 2-step verification on the Google account, verified contact email.
- Publisher display name: the founder's name. Contact email is shown on the listing.
- Trader / non-trader declaration (EU Digital Services Act): non-trader, since the extension is free and there is no commercial service in this version.
- Site verification for wordsnap.ai in Search Console lets the listing show the official URL.
