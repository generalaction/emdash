# Navigation

Navigation consumes validated view refs and optional, JSON-shaped locations.
This phase defines only the portable contracts; stack mechanics and renderer
lifecycles are added by the navigation engine later.

A `NavigationParticipant` lets an active view capture and restore its own
sub-location without teaching the history store about task tabs, editor
selections, or other feature-specific state. Participant attachment returns the
shared `Unsubscribe` lifecycle type.

`Resolution` is deliberately a domain union rather than
`Result<T, E>`. A redirect is an expected navigation outcome, not a failure.
Likewise, a view definition's `safeRef()` returns `undefined` for invalid
untrusted input because callers normally filter or fall back rather than recover
from an error value.
