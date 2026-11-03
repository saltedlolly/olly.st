# olly.st

Olly Stedall's identity page at [olly.st](https://olly.st): the domain behind the Bluesky handle [@olly.st](https://bsky.app/profile/olly.st) and the Nostr address `_@olly.st`. My blog is [saltedlolly.com](https://saltedlolly.com).

A single static page served by GitHub Pages:

- `index.html`, `assets/site.css`, `assets/site.js`: the page, its styles, and the background animation (respects reduced motion) plus the Nostr key's Copy button.
- `.well-known/nostr.json`: Nostr (NIP-05) verification. `_config.yml` tells Jekyll to publish it.
- The Bluesky handle is verified by a DNS TXT record (`_atproto.olly.st`), not by this site.

Preview locally with `python3 -m http.server` and open http://localhost:8000.
