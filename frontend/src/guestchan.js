// Channels rendered outside the main channel slot (the workspace Chat tab, and
// any other embedded ChatView) register themselves here so App's WebSocket
// dispatcher can route live events — message/typing/reaction/etc. — to their
// _onMsg/_onUpdate/… handlers, and skip unread badges while they're on screen.
// A registry, not a single slot: two chats can be mounted at once (workspace
// chat tab + agent-channel chat), and a single "last one wins" slot made the
// loser silently swallow every live update.
const guests = new Map(); // channel_id -> channel-ish object with _on* handlers

export function setGuestChan(c) { if (c) guests.set(c.id, c); }
export function clearGuestChan(c) { if (c && guests.get(c.id) === c) guests.delete(c.id); }
export function getGuestChans() { return [...guests.values()]; }
export function getGuestChan() { return getGuestChans()[0] || null; }
export function isGuestChan(id) { return guests.has(id); }
