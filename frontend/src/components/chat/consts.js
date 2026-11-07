// shared chat constants
export const QUICK = ["👍", "❤️", "😂", "🔥", "🐝", "⭐", "😮"];
export const EMOJI_PICK = [
  "😀", "😄", "😂", "🤣", "😊", "😉", "😍", "😘", "🤔", "🤨", "😮", "😴",
  "😎", "🥳", "😭", "😤", "🤯", "🥺", "😬", "🙃", "🫡", "🤝",
  "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "✍️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💯", "✨", "🔥", "💥",
  "🎉", "🎊", "🏆", "🥇", "🎯", "🚀", "🐝", "📡", "🤖", "🧠", "🍯", "☕", "🍕", "🎮", "📌", "🧵",
];

export const POLL_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

export const SLASH_COMMANDS = [
  { cmd: "huddle", icon: "✦", usage: "", desc: "summon every resident agent in this channel" },
  { cmd: "summarize", icon: "📝", usage: "[N]", desc: "Scribe recaps the last N messages (5–100)" },
  { cmd: "remind", icon: "⏰", usage: "<10m> <text>", desc: "Reminders bot pings you later (s/m/h/d)" },
  { cmd: "poll", icon: "📊", usage: "<q> | <a> | <b>", desc: "poll with 2–9 options" },
  { cmd: "roll", icon: "🎲", usage: "[NdS]", desc: "roll dice — /roll, /roll 3d6" },
  { cmd: "me", icon: "💬", usage: "<action>", desc: "italic action line — /me waves" },
  { cmd: "shrug", icon: "🤷", usage: "", desc: "¯\\_(ツ)_/¯" },
  { cmd: "tableflip", icon: "😤", usage: "", desc: "(╯°□°)╯︵ ┻━┻" },
  { cmd: "unflip", icon: "🙂", usage: "", desc: "┬─┬ ノ( ゜-゜ノ)" },
];

