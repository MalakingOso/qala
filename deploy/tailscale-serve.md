# Serving Qala over Tailscale

Qala listens on loopback only: `127.0.0.1:8500` (see `qala.service`).
Publish it on the tailnet with:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:8500
```

The app is then reachable at `https://callisto.taila63f23.ts.net:8443`
from any device on the tailnet, including the phone.

Existing mappings on this machine (do not disturb):

- `https://callisto.taila63f23.ts.net/` -> `127.0.0.1:8080` (llama-server)
- `https://callisto.taila63f23.ts.net/sync` -> `127.0.0.1:8081` (Beamer sync)

Qala gets its own port (8443) so it never collides with those.
