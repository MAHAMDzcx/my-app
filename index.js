import "dotenv/config";
import express from "express";
import { spawn } from "node:child_process";
import Discord from "discord.js";
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from "@discordjs/voice";

const TOKEN = process.env.TOKEN?.trim();
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const PORT = Number(process.env.PORT || 3000);

if (!TOKEN) {
  console.error("❌ ضع TOKEN في متغير البيئة ثم شغّل البوت");
  console.error("مثال: TOKEN=توكن_البوت node index.js");
  process.exit(1);
}

const RADIOS = [
  ["أحمد الطرابلسي", "ahmed_altrabulsi"], ["أحمد خضر الطرابلسي", "ahmad_khader_altarabulsi"],
  ["إبراهيم الدوسري", "ibrahim_aldosari"], ["ماهر المعيقلي", "maher_al_meaqli"],
  ["عبدالباسط عبدالصمد", "abdulbasit_abdulsamad_warsh"], ["تفسير القرآن الكريم", "tafseer"],
  ["أذكار الصباح", "athkar_sabah"], ["أذكار المساء", "athkar_masa"],
  ["محمد عبدالكريم", "mohammad_abdullkarem"], ["محمود علي البنا", "mahmoud_ali__albanna"],
  ["محمود خليل الحصري", "mahmoud_khalil_alhussary"], ["علي الحذيفي", "ali_alhuthaifi_qalon"],
  ["السيرة النبوية", "fi_zilal_alsiyra"], ["عبدالرحمن السديس", "abdulrahman_alsudaes"],
  ["أحمد العجمي", "ahmad_alajmy"], ["سعد الغامدي", "saad_alghamdi"],
  ["القرآن الكريم - السعودية", "saudi"], ["القرآن الكريم - مصر", "egypt"],
  ["القرآن الكريم - البحرين", "bahrain"],
].map(([name, value]) => ({ name: `إذاعة ${name}`, value, url: `https://Qurango.net/radio/${value}` }));

const client = new Discord.Client({
  intents: [Discord.GatewayIntentBits.Guilds, Discord.GatewayIntentBits.GuildVoiceStates],
});
// Prevent transient Discord/network errors from becoming an unhandled process crash.
client.on("error", error => console.error("⚠️ اتصال Discord:", error.message));
client.on("shardError", error => console.error("⚠️ اتصال Discord الصوتي/الشارد:", error.message));
client.on("warn", message => console.warn("⚠️ Discord:", message));

const sessions = new Map();
const radioByValue = value => RADIOS.find(radio => radio.value === value) || RADIOS[0];
const isExpiredInteraction = error => error?.code === 10062 || error?.rawError?.code === 10062;

async function safeReply(interaction, payload) {
  try {
    if (interaction.deferred) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (error) {
    if (!isExpiredInteraction(error)) console.error("❌ تعذر إرسال رد Discord:", error.message);
  }
}

function stopSession(guildId) {
  const session = sessions.get(guildId);
  if (!session) return;
  session.stopped = true;
  try { session.ffmpeg?.kill("SIGKILL"); } catch {}
  try { session.player?.stop(true); } catch {}
  try { session.connection?.destroy(); } catch {}
  sessions.delete(guildId);
}

function startStream(guildId, connection, radio) {
  const previous = sessions.get(guildId);
  previous?.ffmpeg?.kill("SIGKILL");
  previous?.player?.stop(true);

  const ffmpeg = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "warning", "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-i", radio.url, "-vn", "-f", "s16le", "-ar", "48000", "-ac", "2", "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  const session = { connection, player, ffmpeg, radio, stopped: false };
  sessions.set(guildId, session);

  connection.subscribe(player);
  player.play(createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw }));
  ffmpeg.stderr.setEncoding("utf8");
  ffmpeg.stderr.on("data", message => console.error(`[ffmpeg] ${message.trim()}`));
  ffmpeg.on("error", error => console.error("❌ FFmpeg:", error.message));
  ffmpeg.on("close", code => {
    if (!session.stopped && sessions.get(guildId) === session) {
      console.warn(`⚠️ توقف البث (${code})، إعادة المحاولة بعد 5 ثوانٍ`);
      setTimeout(() => {
        if (!session.stopped && sessions.get(guildId) === session) startStream(guildId, connection, radio);
      }, 5000);
    }
  });
  player.on("error", error => console.error("❌ مشغل Discord:", error.message));
  player.on(AudioPlayerStatus.Playing, () => console.log(`▶️ ${radio.name}`));
}

async function joinAndPlay(guild, channel, radio) {
  stopSession(guild.id);
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
    group: client.user.id,
  });
  connection.on("error", error => console.error("❌ اتصال القناة الصوتية:", error.message));
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  startStream(guild.id, connection, radio);
}

const commands = [
  { name: "join", description: "دخول قناة صوتية وبدء البث", options: [{ name: "channel", description: "القناة الصوتية", type: Discord.ApplicationCommandOptionType.Channel, channel_types: [Discord.ChannelType.GuildVoice], required: true }] },
  { name: "quran", description: "تغيير الإذاعة", options: [{ name: "station", description: "الإذاعة", type: Discord.ApplicationCommandOptionType.String, required: true, choices: RADIOS.map(r => ({ name: r.name, value: r.value })) }] },
  { name: "stop", description: "إيقاف البث" },
  { name: "status", description: "عرض حالة البث" },
];

client.once("clientReady", async () => {
  console.log(`✅ تم تسجيل الدخول: ${client.user.tag}`);
  client.user.setActivity(process.env.STATUS || "إذاعة القرآن الكريم", { type: Discord.ActivityType.Listening });
  try { await client.application.commands.set(commands); console.log("📋 تم تسجيل أوامر البوت"); }
  catch (error) { console.error("❌ تعذر تسجيل الأوامر:", error.message); }

  // تشغيل تلقائي اختياري: ضع VOICE_CHANNEL_ID وRADIO في متغيرات البيئة.
  if (process.env.VOICE_CHANNEL_ID) {
    const channel = client.channels.cache.get(process.env.VOICE_CHANNEL_ID);
    if (channel?.type === Discord.ChannelType.GuildVoice) {
      try { await joinAndPlay(channel.guild, channel, radioByValue(process.env.RADIO)); }
      catch (error) { console.error("❌ فشل التشغيل التلقائي:", error.message); }
    }
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  try {
    if (interaction.commandName === "join") {
      // يجب تنفيذ defer خلال أول 3 ثوانٍ، قبل أي اتصال أو انتظار.
      await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
      const channel = interaction.options.getChannel("channel");
      if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return safeReply(interaction, "❌ اختر قناة صوتية فقط");
      await joinAndPlay(interaction.guild, channel, RADIOS[0]);
      return safeReply(interaction, `✅ دخلت **${channel.name}** وبدأت بث **${RADIOS[0].name}**`);
    }
    if (interaction.commandName === "quran") {
      const session = sessions.get(interaction.guild.id);
      const radio = radioByValue(interaction.options.getString("station"));
      if (!session) return safeReply(interaction, { content: "❌ استخدم /join أولًا", flags: Discord.MessageFlags.Ephemeral });
      startStream(interaction.guild.id, session.connection, radio);
      return safeReply(interaction, `📻 تم تغيير الإذاعة إلى **${radio.name}**`);
    }
    if (interaction.commandName === "stop") {
      stopSession(interaction.guild.id);
      return safeReply(interaction, "⛔ تم إيقاف البث ومغادرة القناة");
    }
    if (interaction.commandName === "status") {
      const session = sessions.get(interaction.guild.id);
      return safeReply(interaction, { content: session ? `📻 الإذاعة الحالية: **${session.radio.name}**` : "📭 لا يوجد بث، استخدم /join", flags: Discord.MessageFlags.Ephemeral });
    }
  } catch (error) {
    if (!isExpiredInteraction(error)) console.error("❌ خطأ في الأمر:", error);
    if (!isExpiredInteraction(error)) await safeReply(interaction, { content: `❌ ${error.message}`, flags: Discord.MessageFlags.Ephemeral });
  }
});

const app = express();
app.get("/", (_request, response) => response.json({ status: "online", streams: sessions.size }));
app.listen(PORT, "0.0.0.0", () => console.log(`🌐 HTTP على المنفذ ${PORT}`));

client.login(TOKEN).catch(error => console.error("❌ تعذر تسجيل الدخول:", error.message));
