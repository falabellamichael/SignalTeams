"""Pydantic request models for the SignalTeams API."""
from pydantic import BaseModel, Field

class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    display_name: str = Field(default="", max_length=64)
    password: str = Field(min_length=4, max_length=128)


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    display_name: str | None = None
    avatar_emoji: str | None = None
    avatar_color: str | None = None
    bio: str | None = None
    status: str | None = None
    seen_buzz: float | None = None
    muted: list[int] | None = None
    notify_mentions: list[int] | None = None
    server_muted: list[int] | None = None
    server_order: list[int] | None = None
    status_text: str | None = None


class FriendIn(BaseModel):
    username: str


class ServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = "🍯"


class JoinIn(BaseModel):
    invite_code: str


class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    kind: str = "text"
    topic: str = ""
    roster: list[int] = []
    category: str = ""
    role_id: int | None = None
    voice_cap: int = 0


class MessageIn(BaseModel):
    content: str = Field(default="", max_length=4000)
    agent_id: int | None = None
    pack_id: int | None = None
    reply_to: int | None = None
    thread_root: int | None = None
    fwd_of: int | None = None
    attachments: list[dict] = []
    poll: dict | None = None     # {q, options:[str..]} — votes live in message_reactions


class PackIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = Field(default="📦", max_length=8)
    description: str = Field(default="", max_length=400)
    agent_ids: list[int] = []


class AgentIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    icon: str = "🤖"
    tagline: str = ""
    description: str = ""
    system_prompt: str = ""
    model: str = ""
    temperature: float | None = None         # NULL → provider default (0.7)
    context_url: str = ""                    # fetched before each reply → grounding
    context_method: str = "GET"
    context_headers: str | None = None
    api_kind: str = ""                       # "" | openai | anthropic | ollama | webhook
    api_url: str = ""
    api_key: str | None = None               # None keeps stored key; "" clears
    api_headers: str | None = None
    tags: list[str] = []
    version: str = "1.0.0"
    visibility: str = "friends"


class SupabaseIn(BaseModel):
    access_token: str = Field(min_length=10)


class PasswordIn(BaseModel):
    current: str = ""
    next: str = Field(min_length=4, max_length=128)
    kick_others: bool = True


class ServerPatch(BaseModel):
    name: str | None = None
    icon: str | None = None
    icon_file: str | None = None               # file id → uploaded icon; "" clears
    star_threshold: int | None = None          # 0 disables the starboard
    llm_url: str | None = None                 # "" clears the shared endpoint
    llm_key: str | None = None                 # write-only — never serialized back
    llm_model: str | None = None
    llm_kind: str | None = None


class NickIn(BaseModel):
    nickname: str = Field(default="", max_length=48)


class TransferIn(BaseModel):
    user_id: int


class RoleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=24)
    color: str = "#e8b339"


class MemberRoleIn(BaseModel):
    role_id: int


class ChannelPatch(BaseModel):
    name: str | None = None
    topic: str | None = None
    roster: list[int] | None = None
    category: str | None = None
    slowmode_secs: int | None = None
    voice_cap: int | None = None  # absent = unchanged · 0 = unlimited voice occupancy
    role_id: int | None = None    # absent = unchanged · 0 = open to all · N = gate to role


class GroupDmIn(BaseModel):
    user_ids: list[int]
    name: str = ""


class AgentDmAddIn(BaseModel):
    agent_id: int


class DmRenameIn(BaseModel):
    name: str


class SummarizeIn(BaseModel):
    count: int = Field(default=25, ge=5, le=100)


class KnockIn(BaseModel):
    approve: bool = True


class ReminderIn(BaseModel):
    channel_id: int
    seconds: int = Field(ge=10, le=604800)               # 10s … 7d
    text: str = Field(min_length=1, max_length=200)


class EditIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class ReactIn(BaseModel):
    emoji: str = Field(min_length=1, max_length=8)


class ReviewIn(BaseModel):
    rating: int = Field(ge=0, le=5, default=0)
    body: str = Field(default="", max_length=2000)


class TryIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[dict] = []
    model: str | None = None
    provider: str | None = None


class LlmConfigIn(BaseModel):
    base_url: str = ""
    api_key: str | None = None                # None keeps the stored key; "" clears
    model: str = ""
    kind: str = "openai"                      # openai | webhook
    headers: str | None = None                # JSON of extra request headers


class AgentConnectIn(BaseModel):
    api_kind: str = ""                        # "" | openai | anthropic | ollama | webhook
    api_url: str = ""
    api_key: str | None = None                # None keeps stored key; "" clears
    model: str | None = None
    api_headers: str | None = None            # JSON object string
    context_url: str | None = None
    context_method: str | None = None         # GET | POST
    context_headers: str | None = None        # JSON object string
