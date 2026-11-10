import { Paperclip, Smiley, Eye, Sparkle, PaperPlaneRight, Gear, Bell, BellSlash,
  MagnifyingGlass, PushPin, Headphones, PencilSimple, X, Plus, PlusCircle, Check,
  Lock, LockOpen, Prohibit, Hash, Users, User, CaretRight, CaretDown, Link, Share, Star, Trash,
  FloppyDisk, ArrowCounterClockwise, DownloadSimple, Chat, ChatCircle, BookmarkSimple,
  SmileyWink, Microphone, MicrophoneSlash, SpeakerHigh, SpeakerX, VideoCamera,
  MonitorPlay, Phone, PhoneSlash, DotsThree, Copy, ArrowUp, ArrowDown,
  House, Moon, Sun, Clock, ListPlus, UserPlus, UserMinus, Warning,
  MagnifyingGlassPlus, FileArrowDown, RocketLaunch, Code, Cube, TrendUp,
  Palette, Key, Lightning, SignOut, CheckCircle, XCircle, Info, Question,
  HandWaving, Gift, MapPin, Calendar, Tag, Package, ArrowsLeftRight,
  PaperPlaneTilt, ChatDots, UsersThree, EnvelopeSimple, At, Image as ImageIc,
  Tray, List, ArrowBendUpLeft, ArrowBendUpRight, CornersOut, ArrowSquareOut,
  GitFork, Sliders, Broadcast, Robot, DoorOpen, Checks, Timer, ChartBar,
  Keyboard, TerminalWindow, Globe, Translate, Article, Folder, FolderPlus,
  Watch }
  from "@phosphor-icons/react";

const MAP = {
  clip: Paperclip, emoji: Smiley, eye: Eye, sparkle: Sparkle, send: PaperPlaneRight,
  gear: Gear, bell: Bell, bellOff: BellSlash, search: MagnifyingGlass, pin: PushPin,
  phones: Headphones, edit: PencilSimple, x: X, plus: Plus, plusCircle: PlusCircle,
  check: Check, checks: Checks, lock: Lock, unlock: LockOpen, ban: Prohibit,
  hash: Hash, users: Users, user: User,
  caretR: CaretRight, caretD: CaretDown, link: Link, share: Share, star: Star,
  trash: Trash, save: FloppyDisk, reset: ArrowCounterClockwise, refresh: ArrowCounterClockwise,
  dl: DownloadSimple, download: DownloadSimple,
  chat: Chat, chatCircle: ChatCircle, bookmark: BookmarkSimple, wink: SmileyWink,
  mic: Microphone, micOff: MicrophoneSlash, deaf: SpeakerHigh, undeaf: SpeakerX,
  video: VideoCamera, camera: VideoCamera, screen: MonitorPlay, phone: Phone, hangup: PhoneSlash,
  dots: DotsThree, copy: Copy, up: ArrowUp, down: ArrowDown, home: House,
  moon: Moon, sun: Sun, clock: Clock, listPlus: ListPlus, userPlus: UserPlus,
  userMinus: UserMinus, warn: Warning, zoom: MagnifyingGlassPlus,
  fileDl: FileArrowDown, rocket: RocketLaunch, code: Code, cube: Cube,
  trend: TrendUp, pulse: TrendUp, palette: Palette, key: Key, bolt: Lightning,
  logout: SignOut, leave: DoorOpen,
  ok: CheckCircle, bad: XCircle, info: Info, help: Question, question: Question,
  wave: HandWaving, gift: Gift, pinLoc: MapPin, cal: Calendar, tag: Tag, pkg: Package,
  swap: ArrowsLeftRight, plane: PaperPlaneTilt, dots3: ChatDots,
  group: UsersThree, mail: EnvelopeSimple, at: At, image: ImageIc,
  tray: Tray, list: List, reply: ArrowBendUpLeft, forward: ArrowBendUpRight,
  expand: CornersOut, ext: ArrowSquareOut, fork: GitFork, sliders: Sliders,
  dish: Broadcast, bot: Robot, door: DoorOpen, timer: Timer, chart: ChartBar,
  kb: Keyboard, term: TerminalWindow,
  globe: Globe, speaker: SpeakerHigh, translate: Translate, article: Article, folder: Folder, folderPlus: FolderPlus,
  watch: Watch,
};

/** Icon shorthand — <Ico n="clip" /> renders a Phosphor glyph. */
export default function Ico({ n, s = 15, w = "regular", style, className }) {
  const C = MAP[n];
  if (!C) return null;
  return <C size={s} weight={w} style={{ flexShrink: 0, ...style }} className={className} />;
}
