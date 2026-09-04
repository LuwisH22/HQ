/**
 * Side-effect module: captures the invitation token at import time.
 *
 * This exists as its own file because `import` declarations are hoisted — a
 * bare function call in `main.tsx` would run *after* every import in that file
 * had already been evaluated, including the router, which reads
 * `window.location` as it is constructed.
 *
 * Module bodies, by contrast, execute in import order. Importing this above
 * `./App` is therefore the only reliable way to strip the token from the URL
 * before anything else observes it.
 */
import { captureInviteTokenFromUrl } from './invite-token'
import { captureInviteSessionFromUrl } from './invite-session'

// Query first, then fragment. The token strip preserves the fragment that the
// session capture is about to read; doing it the other way round would leave
// the raw token in the URL for longer than necessary.
captureInviteTokenFromUrl()
captureInviteSessionFromUrl()
