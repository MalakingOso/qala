# Coach wire fixtures

The request and the responses of `POST /api/coach/ask` (`server/coach.ts`),
written by hand. They are the contract in one place: `server/coach_test.ts`
checks that the route sends exactly these bodies, and the Kotlin client's
`CoachWireTest` (`apps/android/app/src/test`) parses and builds the same files.
Change a field here and both sides fail until they agree.

- `ask_request.json`: a request with a thread, the day's context and a lift.
- `ask_ok.json`: the 200 answer the fake model's reply produces, with a suggestion.
- `ask_declined.json`: the 200 answer when the question is outside the coach's topics.
- `ask_degraded.json`: the 502 body when the model is down, slow or unusable.
- `ask_unauthorized.json`: the 401 body when the request has no Tailscale identity.
