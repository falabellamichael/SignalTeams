// Tiny fetch wrapper — token from localStorage, JSON in/out.
const TOKEN_KEY = "signalteams.token";

export function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function reqForm(path, fd) {
  const res = await fetch(path, {
    method: "POST",
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    body: fd,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`);
  return data;
}

export const api = {
  raw: (path) => req("GET", path),
  authConfig: () => req("GET", "/api/auth/config"),
  supabaseAuth: (access_token) => req("POST", "/api/auth/supabase", { access_token }),
  setPassword: (current, next) => req("POST", "/api/me/password", { current, next }),
  signoutOthers: () => req("POST", "/api/me/signout-others"),
  exportData: async () => {
    const res = await fetch("/api/me/export", {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `signalteams-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  // auth
  register: (username, password, display_name) =>
    req("POST", "/api/register", { username, password, display_name }),
  login: (username, password) => req("POST", "/api/login", { username, password }),
  me: () => req("GET", "/api/me"),
  updateMe: (patch) => req("PATCH", "/api/me", patch),
  people: () => req("GET", "/api/people"),
  profile: (uid) => req("GET", `/api/users/${uid}/profile`),

  // friends
  friends: () => req("GET", "/api/friends"),
  addFriend: (username) => req("POST", "/api/friends", { username }),
  acceptFriend: (fid) => req("POST", `/api/friends/${fid}/accept`),
  removeFriend: (fid) => req("DELETE", `/api/friends/${fid}`),

  // servers & channels
  servers: () => req("GET", "/api/servers"),
  createServer: (name, icon) => req("POST", "/api/servers", { name, icon }),
  joinServer: (invite_code) => req("POST", "/api/servers/join", { invite_code }),
  addEmoji: (sid, name, file) => {
    const fd = new FormData();
    fd.append("name", name); fd.append("file", file);
    return reqForm(`/api/servers/${sid}/emojis`, fd);
  },
  delEmoji: (eid) => req("DELETE", `/api/emojis/${eid}`),
  addRole: (sid, name, color) => req("POST", `/api/servers/${sid}/roles`, { name, color }),
  delRole: (rid) => req("DELETE", `/api/roles/${rid}`),
  toggleMemberRole: (sid, uid, role_id) =>
    req("POST", `/api/servers/${sid}/members/${uid}/roles`, { role_id }),
  inviteInfo: (code) => req("GET", `/api/invite/${encodeURIComponent(code)}`),
  server: (id) => req("GET", `/api/servers/${id}`),
  pulse: (sid) => req("GET", `/api/servers/${sid}/pulse`),
  kickMember: (sid, uid) => req("DELETE", `/api/servers/${sid}/members/${uid}`),
  transferServer: (sid, user_id) => req("POST", `/api/servers/${sid}/transfer`, { user_id }),
  setNick: (sid, nickname) => req("POST", `/api/servers/${sid}/nick`, { nickname }),
  addChannel: (sid, name, kind, topic, roster, category, slowmode_secs = 0, role_id = 0, voice_cap = 0, lurkers = []) =>
    req("POST", `/api/servers/${sid}/channels`, { name, kind, topic, roster, category, slowmode_secs, role_id, voice_cap, lurkers }),

  // dms
  dms: () => req("GET", "/api/dms"),
  openDm: (userId) => req("POST", `/api/dms/${userId}`),
  dmAgent: (aid) => req("POST", `/api/agents/${aid}/dm`),
  groupDm: (user_ids, name) => req("POST", "/api/dms/group", { user_ids, name }),
  leaveDm: (cid) => req("POST", `/api/dms/${cid}/leave`),
  inbox: () => req("GET", "/api/inbox"),
  blocks: () => req("GET", "/api/blocks"),
  block: (uid) => req("POST", `/api/blocks/${uid}`),
  saveMsg: (mid) => req("POST", `/api/messages/${mid}/save`),
  saved: () => req("GET", "/api/saved"),
  dmAdd: (cid, user_ids) => req("POST", `/api/dms/${cid}/add`, { user_ids }),
  dmAddAgent: (cid, agent_id) => req("POST", `/api/dms/${cid}/add-agent`, { agent_id }),
  dmRename: (cid, name) => req("PATCH", `/api/dms/${cid}`, { name }),

  // messages
  messages: (cid, before) =>
    req("GET", `/api/channels/${cid}/messages${before ? `?before=${before}` : ""}`),
  send: (cid, content, agent_id, attachments, pack_id, reply_to, thread_root, fwd_of, poll, title) =>
    req("POST", `/api/channels/${cid}/messages`,
      { content, agent_id, pack_id, reply_to, thread_root, fwd_of, attachments, poll, title }),
  messageAi: (mid, op, extra = "") => req("POST", `/api/messages/${mid}/ai`, { op, extra }),
  thread: (mid) => req("GET", `/api/messages/${mid}/thread`),
  markRead: (cid) => req("POST", `/api/channels/${cid}/read`, {}),
  huddle: (cid) => req("POST", `/api/channels/${cid}/huddle`),
  summarize: (cid, count) => req("POST", `/api/channels/${cid}/summarize`, { count }),
  knock: (cid) => req("POST", `/api/channels/${cid}/knock`),
  knocks: (cid) => req("GET", `/api/channels/${cid}/knocks`),
  resolveKnock: (cid, uid, approve) => req("POST", `/api/channels/${cid}/knocks/${uid}`, { approve }),
  reminders: () => req("GET", "/api/reminders"),
  delReminder: (rid) => req("DELETE", `/api/reminders/${rid}`),
  remind: (channel_id, seconds, text) => req("POST", `/api/reminders`,
    { channel_id, seconds, text }),
  editMessage: (mid, content) => req("PATCH", `/api/messages/${mid}`, { content }),
  upload: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return reqForm("/api/upload", fd);
  },
  fileUrl: (id) => `/api/files/${id}?token=${encodeURIComponent(getToken())}`,
  delMessage: (mid) => req("DELETE", `/api/messages/${mid}`),
  react: (mid, emoji) => req("POST", `/api/messages/${mid}/react`, { emoji }),
  pinMessage: (mid) => req("POST", `/api/messages/${mid}/pin`),
  editServer: (sid, p) => req("PATCH", `/api/servers/${sid}`, p),
  regenInvite: (sid) => req("POST", `/api/servers/${sid}/invite`),
  reorderChannels: (sid, order) => req("POST", `/api/servers/${sid}/channels/order`, { order }),
  llmMe: () => req("GET", "/api/me/llm"),
  llmSave: (p) => req("PUT", "/api/me/llm", p),
  llmTest: () => req("POST", "/api/me/llm/test"),
  markUnread: (cid, mid) => req("POST", `/api/channels/${cid}/mark-unread`, { message_id: mid }),
  readAll: () => req("POST", "/api/me/read-all"),
  serverLlmTest: (sid) => req("POST", `/api/servers/${sid}/llm/test`),
  serverAudit: (sid, before) => req("GET", `/api/servers/${sid}/audit${before ? `?before=${before}` : ""}`),
  serverBans: (sid) => req("GET", `/api/servers/${sid}/bans`),
  banMember: (sid, uid, reason = "") => req("POST", `/api/servers/${sid}/bans/${uid}`, { reason }),
  unbanMember: (sid, uid) => req("DELETE", `/api/servers/${sid}/bans/${uid}`),
  timeoutMember: (sid, uid, minutes) => req("POST", `/api/servers/${sid}/members/${uid}/timeout`, { minutes }),
  deleteServer: (sid) => req("DELETE", `/api/servers/${sid}`),
  getTemplate: (sid) => req("GET", `/api/servers/${sid}/template`),
  saveTemplate: (sid) => req("POST", `/api/servers/${sid}/template`),
  delTemplate: (sid) => req("DELETE", `/api/servers/${sid}/template`),
  templatePreview: (code) => req("GET", `/api/templates/${code}`),
  serverFromTemplate: (code, name = "") => req("POST", "/api/servers/from-template", { code, name }),
  leaveServer: (sid) => req("POST", `/api/servers/${sid}/leave`),
  editChannel: (cid, p) => req("PATCH", `/api/channels/${cid}`, p),
  deleteChannel: (cid) => req("DELETE", `/api/channels/${cid}`),
  webhooks: (cid) => req("GET", `/api/channels/${cid}/webhooks`),
  createWebhook: (cid, name, icon) => req("POST", `/api/channels/${cid}/webhooks`, { name, icon }),
  editWebhook: (wid, p) => req("PATCH", `/api/webhooks/${wid}`, p),
  delWebhook: (wid) => req("DELETE", `/api/webhooks/${wid}`),
  setDigest: (cid, p) => req("PUT", `/api/channels/${cid}/digest`, p),
  delDigest: (cid) => req("DELETE", `/api/channels/${cid}/digest`),
  serverEvents: (sid) => req("GET", `/api/servers/${sid}/events`),
  addEvent: (sid, p) => req("POST", `/api/servers/${sid}/events`, p),
  editEvent: (eid, p) => req("PATCH", `/api/events/${eid}`, p),
  delEvent: (eid) => req("DELETE", `/api/events/${eid}`),
  eventInterested: (eid) => req("POST", `/api/events/${eid}/interested`),
  pins: (cid) => req("GET", `/api/channels/${cid}/pins`),
  searchChannel: (cid, q) => req("GET", `/api/channels/${cid}/search?q=${encodeURIComponent(q)}`),
  searchAll: (q) => req("GET", `/api/search?q=${encodeURIComponent(q)}`),

  // agents
  trending: () => req("GET", "/api/agents/trending"),
  agentStats: (aid) => req("GET", `/api/agents/${aid}/stats`),
  peekMessage: (mid) => req("GET", `/api/messages/${mid}/peek`),
  agents: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return req("GET", `/api/agents${q ? `?${q}` : ""}`);
  },
  createAgent: (a) => req("POST", "/api/agents", a),
  agent: (id) => req("GET", `/api/agents/${id}`),
  updateAgent: (id, a) => req("PATCH", `/api/agents/${id}`, a),
  agentConnect: (id, p) => req("PUT", `/api/agents/${id}/connect`, p),
  agentConnectTest: (id, p) => req("POST", `/api/agents/${id}/connect/test`, p || {}),
  deleteAgent: (id) => req("DELETE", `/api/agents/${id}`),
  starAgent: (id) => req("POST", `/api/agents/${id}/star`),
  installAgent: (id) => req("POST", `/api/agents/${id}/install`),
  forkAgent: (id) => req("POST", `/api/agents/${id}/fork`),
  importAgent: (json) => req("POST", "/api/agents/import", json),
  bench: () => req("GET", "/api/bench"),
  reviews: (aid) => req("GET", `/api/agents/${aid}/reviews`),
  postReview: (aid, rating, body) => req("POST", `/api/agents/${aid}/reviews`, { rating, body }),
  tryAgent: (aid, message, history, model, provider) =>
    req("POST", `/api/agents/${aid}/try`, { message, history, model, provider }),
  llmProviders: () => req("GET", "/api/llm/providers"),
  history: (aid) => req("GET", `/api/agents/${aid}/history`),

  // packs
  packs: () => req("GET", "/api/packs"),
  pack: (id) => req("GET", `/api/packs/${id}`),
  createPack: (p) => req("POST", "/api/packs", p),
  deletePack: (id) => req("DELETE", `/api/packs/${id}`),
  benchPack: (id) => req("POST", `/api/packs/${id}/bench`),
  forkPack: (id) => req("POST", `/api/packs/${id}/fork`),

  // buzz
  buzz: () => req("GET", "/api/buzz"),
};
