const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  EmbedBuilder, 
  StringSelectMenuBuilder, 
  PermissionFlagsBits,
  PermissionsBitField
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v2: cloudinary } = require('cloudinary');
require('dotenv').config();

// إعداد سيرفر الويب لضمان التشغيل 24/7
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is running 24/7!'));
app.listen(PORT, () => console.log(`Server is listening on port ${PORT}`));

// إعداد عميل دسكورد مع الصلاحيات المطلوبة
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ملفات البيانات القديمة تُستخدم فقط كنسخة احتياطية/ترحيل، والتخزين الأساسي في Supabase.
const DB_FILE = path.join(__dirname, 'notices_db.json');
const CONFIG_FILE = path.join(__dirname, 'config_db.json');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !process.env.CLOUDINARY_CLOUD_NAME ||
  !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  throw new Error('متغيرات Supabase وCloudinary غير مكتملة في Environment Variables.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

let noticesCache = [];
let configCache = {};

function loadDB() {
  return noticesCache;
}
async function saveDB(data) {
  noticesCache = data;
  const rows = data.map(notice => ({
    id: notice.id,
    guild_id: notice.guildId,
    status: notice.status || 'pending',
    type: notice.type,
    author: notice.author,
    name: notice.name,
    family: notice.family || null,
    traits: notice.traits || null,
    plate: notice.plate || null,
    reason: notice.reason,
    discord_id: notice.discordId || null,
    image_url: notice.image || null,
    created_at: new Date(notice.timestamp || Date.now()).toISOString(),
    last_searched_at: new Date(notice.lastSearched || notice.timestamp || Date.now()).toISOString(),
    archived_at: notice.archivedAt ? new Date(notice.archivedAt).toISOString() : null
  }));
  const { error: deleteError } = await supabase.from('notices').delete().neq('id', '');
  if (deleteError) throw deleteError;
  if (rows.length) {
    const { error } = await supabase.from('notices').insert(rows);
    if (error) throw error;
  }
}

function loadConfig() {
  return configCache;
}
async function saveConfig(data) {
  configCache = data;
  const rows = Object.entries(data).map(([guildId, config]) => ({
    guild_id: guildId,
    admin_id: config.adminId || null,
    archive_id: config.archiveId || null,
    public_id: config.publicId || null,
    shortcuts: config.shortcuts || []
  }));
  const { error: deleteError } = await supabase.from('guild_configs').delete().neq('guild_id', '');
  if (deleteError) throw deleteError;
  if (rows.length) {
    const { error } = await supabase.from('guild_configs').insert(rows);
    if (error) throw error;
  }
}

async function initializeStorage() {
  const [{ data: noticeRows, error: noticesError }, { data: configRows, error: configError }] = await Promise.all([
    supabase.from('notices').select('*'),
    supabase.from('guild_configs').select('*')
  ]);
  if (noticesError) throw noticesError;
  if (configError) throw configError;

  noticesCache = (noticeRows || []).map(row => ({
    id: row.id,
    guildId: row.guild_id,
    status: row.status,
    type: row.type,
    author: row.author,
    name: row.name,
    family: row.family,
    traits: row.traits,
    plate: row.plate,
    reason: row.reason,
    discordId: row.discord_id,
    image: row.image_url,
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    lastSearched: row.last_searched_at ? new Date(row.last_searched_at).getTime() : Date.now(),
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : null
  }));
  configCache = Object.fromEntries((configRows || []).map(row => [row.guild_id, {
    adminId: row.admin_id,
    archiveId: row.archive_id,
    publicId: row.public_id,
    shortcuts: row.shortcuts || []
  }]));

  if (!noticeRows?.length && fs.existsSync(DB_FILE)) {
    try {
      const legacyNotices = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      noticesCache = Array.isArray(legacyNotices)
        ? legacyNotices.map(notice => ({
          ...notice,
          guildId: notice.guildId || GUILD_ID,
          status: notice.status || 'approved'
        }))
        : [];
      if (noticesCache.length) await saveDB(noticesCache);
    } catch (error) {
      console.error('تعذر ترحيل التعميمات القديمة:', error);
    }
  }

  if (!configRows?.length && fs.existsSync(CONFIG_FILE)) {
    try {
      const legacyConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (legacyConfig && typeof legacyConfig === 'object') await saveConfig(legacyConfig);
    } catch (error) {
      console.error('تعذر ترحيل الإعدادات القديمة:', error);
    }
  }
}

async function uploadImage(imageUrl) {
  const result = await cloudinary.uploader.upload(imageUrl, {
    folder: 't3mem/notices',
    resource_type: 'image'
  });
  return result.secure_url;
}

function buildNoticeEmbed(notice) {
  const embed = new EmbedBuilder()
    .setTitle(notice.type === 'personal' ? 'تعميم شخصي' : 'تعميم لوحة مركبة')
    .setColor(notice.type === 'personal' ? 0xff0000 : 0xffaa00)
    .setDescription(notice.status === 'pending'
      ? 'تعميم بانتظار مراجعة الإدارة.'
      : 'تعميم معتمد ومنشور.')
    .addFields(
      notice.type === 'personal'
        ? { name: 'الاسم', value: notice.name, inline: true }
        : { name: 'اسم المالك', value: notice.name, inline: true },
      notice.type === 'personal'
        ? { name: 'اسم العائلة', value: notice.family, inline: true }
        : { name: 'رقم اللوحة', value: notice.plate, inline: true },
      notice.type === 'personal'
        ? { name: 'الصفات الجسدية', value: notice.traits }
        : { name: 'السبب', value: notice.reason },
      ...(notice.type === 'personal' ? [{ name: 'السبب', value: notice.reason }] : []),
      ...(notice.discordId ? [{ name: 'أيدي Discord', value: `<@${notice.discordId}>`, inline: true }] : []),
      { name: 'المُبلغ', value: notice.author }
    )
    .setTimestamp(notice.timestamp ? new Date(notice.timestamp) : new Date())
    .setFooter({ text: notice.status === 'pending' ? 'بانتظار قبول أو رفض الإدارة' : 'تعميم معتمد' });

  const imageReference = getNoticeImageReference(notice);
  if (imageReference) embed.setImage(imageReference);
  return embed;
}

function buildReviewButtons(noticeId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_notice:${noticeId}`)
      .setLabel('قبول')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject_notice:${noticeId}`)
      .setLabel('رفض')
      .setStyle(ButtonStyle.Danger)
  );
}

function normalizeSearchValue(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function isUsableTextChannel(channel) {
  return channel?.isTextBased?.() === true;
}

function isDiscordImageUrl(imageUrl) {
  const hostname = new URL(imageUrl).hostname.toLowerCase();
  return hostname === 'discord.com' || hostname.endsWith('.discord.com') ||
    hostname === 'discordapp.com' || hostname.endsWith('.discordapp.com') ||
    hostname === 'discordapp.net' || hostname.endsWith('.discordapp.net');
}

function getNoticeImageReference(notice) {
  return notice.image || null;
}

function parsePersonalExtras(value) {
  const parts = String(value || '').split('|').map(part => part.trim()).filter(Boolean);
  const discordId = parts.find(part => /^\d{17,20}$/.test(part)) || '';
  const image = parts.find(part => {
    if (!/^https?:\/\//i.test(part)) return false;
    try { return !isDiscordImageUrl(part); } catch { return false; }
  }) || '';
  return { discordId, image };
}

function isAdministrator(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) === true;
}

// قراءة التوكن من متغيرات البيئة في Render لمنع الأخطاء نهائياً
const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID || "1339621671480332392";
const LEVEL_CONFIG_FILE = path.join(__dirname, 'leveling_config.json');
const LEVEL_PROGRESS_FILE = path.join(__dirname, 'leveling_db.json');
const MAX_LEVEL = 1000;
const voiceTracking = new Map();
const LEVEL_NAMES = [
  'مبتدئ', 'مغامر', 'محترف', 'مميز', 'قائد', 'استثنائي', 'أسطوري',
  'النبيل', 'الشرس', 'المرموق', 'الملهم', 'الأسطورة', 'الفرعون', 'الذئب', 'الملك',
  'السيد', 'العملاق', 'القاتل', 'المدافع', 'القائد الأعلى'
];

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const content = fs.readFileSync(filePath, 'utf8');
    return content ? JSON.parse(content) : fallback;
  } catch (error) {
    console.error(`تعذر قراءة ملف ${filePath}:`, error);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadLevelConfig() {
  return readJsonFile(LEVEL_CONFIG_FILE, {});
}

function saveLevelConfig(data) {
  writeJsonFile(LEVEL_CONFIG_FILE, data);
}

function loadLevelProgress() {
  return readJsonFile(LEVEL_PROGRESS_FILE, {});
}

function saveLevelProgress(data) {
  writeJsonFile(LEVEL_PROGRESS_FILE, data);
}

function getLevelThreshold(level) {
  if (level <= 1) return 0;
  const band = Math.min(Math.floor((level - 1) / 50), 19);
  const relative = (level - 1) % 50;
  const bandBase = [
    0, 1300, 8500, 31000, 96000, 250000, 520000, 1010000,
    1810000, 2930000, 4500000, 6700000, 9600000, 13400000,
    18200000, 24400000, 32200000, 42000000, 55000000, 72000000
  ];
  const base = bandBase[band] || bandBase[bandBase.length - 1];
  const difficultyStep = 70 + band * 180 + relative * (15 + band * 6);
  return Math.round(base + relative * difficultyStep + Math.pow(relative, 2) * (10 + band * 16));
}

function getLevelFromXp(xp) {
  let level = 1;
  while (level < MAX_LEVEL && xp >= getLevelThreshold(level + 1)) {
    level += 1;
  }
  return level;
}

function getLevelName(level) {
  const index = Math.min(Math.floor((level - 1) / 50), LEVEL_NAMES.length - 1);
  return LEVEL_NAMES[index] || 'الأسطورة';
}

function getProgressBar(currentXP, currentLevel) {
  const nextLevel = currentLevel + 1;
  const currentNeed = currentXP - getLevelThreshold(currentLevel);
  const nextNeed = getLevelThreshold(nextLevel) - getLevelThreshold(currentLevel);
  const progress = nextNeed <= 0 ? 1 : Math.max(0, Math.min(1, currentNeed / nextNeed));
  const filled = Math.round(progress * 12);
  return `${'█'.repeat(filled)}${'░'.repeat(12 - filled)}`;
}

function getLevelProgressValue(level) {
  const xp = getLevelThreshold(level);
  return xp > 0 ? `${xp.toLocaleString('en-US')} XP` : '0 XP';
}

function ensureGuildProgress(guildId) {
  const data = loadLevelProgress();
  if (!data[guildId]) data[guildId] = {};
  saveLevelProgress(data);
  return data[guildId];
}

function ensureUserProgress(guildId, userId) {
  const guildData = ensureGuildProgress(guildId);
  if (!guildData[userId]) {
    guildData[userId] = {
      userId,
      messages: 0,
      voiceMinutes: 0,
      xp: 0,
      level: 0
    };
    saveLevelProgress(loadLevelProgress());
  }
  return guildData[userId];
}

function syncUserLevel(entry) {
  entry.level = Math.min(MAX_LEVEL, getLevelFromXp(Number(entry.xp || 0)));
  return entry;
}

async function announceLevelUp(guildId, userId, previousLevel, newLevel, xpValue) {
  const config = loadLevelConfig();
  const guildConfig = config[guildId];
  if (!guildConfig?.announceChannelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(guildConfig.announceChannelId);
  if (!channel || !isUsableTextChannel(channel)) return;

  const member = await guild.members.fetch(userId).catch(() => null);
  const mention = member ? `<@${userId}>` : `<@${userId}>`;
  const levelName = getLevelName(newLevel);
  const nextThreshold = getLevelThreshold(newLevel + 1);
  const nextText = nextThreshold > 0 ? `الفل التالي: ${nextThreshold.toLocaleString('en-US')} XP` : 'هذا هو أعلى فل';

  await channel.send({
    content: `🎉 ${mention} ارتقى إلى فل ${newLevel} (${levelName})\n✨ XP الحالي: ${xpValue.toLocaleString('en-US')}\n📈 ${nextText}`
  });
}

async function refreshLevelBoardForGuild(guildId) {
  const config = loadLevelConfig();
  const guildConfig = config[guildId];
  if (!guildConfig?.boardChannelId) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const boardChannel = guild.channels.cache.get(guildConfig.boardChannelId);
  if (!boardChannel || !isUsableTextChannel(boardChannel)) return;

  const allProgress = loadLevelProgress()[guildId] || {};
  const list = Object.values(allProgress)
    .map(entry => ({
      userId: entry.userId,
      messages: Number(entry.messages || 0),
      voiceMinutes: Number(entry.voiceMinutes || 0),
      xp: Number(entry.xp || 0),
      level: Number(entry.level || getLevelFromXp(Number(entry.xp || 0)))
    }))
    .filter(entry => entry.userId);

  const topMessages = [...list].sort((a, b) => b.messages - a.messages).slice(0, 8);
  const topVoice = [...list].sort((a, b) => b.voiceMinutes - a.voiceMinutes).slice(0, 8);
  const topXp = [...list].sort((a, b) => b.xp - a.xp).slice(0, 8);

  const formatRank = (items, suffix) => items.length
    ? items.map((item, index) => `${index + 1}. <@${item.userId}> • ${suffix}: ${item[suffix]}`).join('\n')
    : 'لا يوجد بيانات بعد.';

  const embed = new EmbedBuilder()
    .setTitle('📊 لوحة النشاط والفل | LEVEL BOARD')
    .setDescription('أفضل الأعضاء حسب الرسائل، الوقت الصوتي، والمستوى العام. التحديث التلقائي كل ساعة.')
    .setColor(0x00d1b2)
    .addFields(
      { name: '🏆 أعلى 8 رسائل', value: formatRank(topMessages, 'messages'), inline: false },
      { name: '🔊 أعلى 8 صوت', value: formatRank(topVoice, 'voiceMinutes'), inline: false },
      { name: '✨ أعلى 8 XP', value: topXp.map((item, index) => `${index + 1}. <@${item.userId}> • XP ${item.xp.toLocaleString('en-US')} • فل ${item.level} • ${getLevelName(item.level)}`).join('\n') || 'لا يوجد بيانات بعد.', inline: false },
      { name: '🔒 الحد الأقصى', value: `الفل الأعلى هو ${MAX_LEVEL} • كل 50 فل تصبح الترقية أصعب بكثير.` }
    )
    .setFooter({ text: `آخر تحديث: ${new Date().toLocaleString('ar-SA')}` })
    .setTimestamp(new Date());

  try {
    if (guildConfig.messageId) {
      const oldMessage = await boardChannel.messages.fetch(guildConfig.messageId).catch(() => null);
      if (oldMessage) {
        await oldMessage.edit({ embeds: [embed] });
        return;
      }
    }

    const sent = await boardChannel.send({ embeds: [embed] });
    guildConfig.messageId = sent.id;
    config[guildId] = guildConfig;
    saveLevelConfig(config);
  } catch (error) {
    console.error(`تعذر تحديث لوحة النشاط في السيرفر ${guildId}:`, error);
  }
}

async function refreshAllLevelBoards() {
  const config = loadLevelConfig();
  for (const guildId of Object.keys(config)) {
    await refreshLevelBoardForGuild(guildId);
  }
}

if (!TOKEN) {
  throw new Error('متغير TOKEN/DISCORD_TOKEN غير موجود. أضف توكن البوت إلى متغيرات البيئة (Environment) في موقع Render ثم أعد التشغيل.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-panel')
    .setDescription('إعداد لوحة التعميمات والإدارة')
    .addChannelOption(option => 
      option.setName('admin-channel').setDescription('روم الإدارة والمراجعة').setRequired(true))
    .addChannelOption(option => 
      option.setName('archive-channel').setDescription('روم الأرشيف التلقائي').setRequired(true))
    .addChannelOption(option =>
      option.setName('public-channel').setDescription('الروم العام لنشر التعميمات المقبولة').setRequired(true)),
  new SlashCommandBuilder()
    .setName('add-shortcut')
    .setDescription('إضافة اختصار إلى قائمة الاختصارات')
    .addStringOption(option =>
      option.setName('name').setDescription('اسم الاختصار الظاهر في القائمة').setRequired(true).setMaxLength(100))
    .addStringOption(option =>
      option.setName('text').setDescription('النص الجاهز للاختصار').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder()
    .setName('remove-shortcut')
    .setDescription('حذف اختصار من القائمة')
    .addStringOption(option =>
      option.setName('name').setDescription('اسم الاختصار المراد حذفه').setRequired(true).setMaxLength(100)),
  new SlashCommandBuilder()
    .setName('setup-levels')
    .setDescription('إعداد لوحة النشاط والفل حتى المستوى 1000')
    .addChannelOption(option =>
      option.setName('board-channel').setDescription('الروم الذي ستظهر فيه لوحة المتصدرين').setRequired(true))
    .addChannelOption(option =>
      option.setName('announce-channel').setDescription('الروم الذي يرسل فيه تنبيهات الترقية').setRequired(true)),
  new SlashCommandBuilder()
    .setName('rank')
    .setDescription('عرض مستوى اللاعب وXP الخاص بك')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommandsForGuild(guildId) {
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: [] });
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log(`تم تسجيل أوامر السلاش داخل السيرفر ${guildId}`);
}

async function removeGlobalCommands() {
  const globalCommands = await rest.get(Routes.applicationCommands(client.user.id));
  for (const command of globalCommands) {
    await rest.delete(Routes.applicationCommand(client.user.id, command.id));
  }
}

client.once('ready', async () => {
  console.log(`تم تسجيل الدخول بنجاح باسم ${client.user.tag}`);
  try {
    await initializeStorage();
    if (client.guilds.cache.size === 0) {
      throw new Error('لم ينضم البوت إلى أي سيرفر. أضفه بصلاحية applications.commands ثم أعد التشغيل.');
    }

    // إزالة الأوامر العالمية القديمة حتى لا تظهر مع أوامر السيرفر مرتين.
    await removeGlobalCommands();
    for (const guild of client.guilds.cache.values()) {
      await registerCommandsForGuild(guild.id);
    }
  } catch (error) {
    console.error(error);
  }
});

client.on('guildCreate', async guild => {
  try {
    await registerCommandsForGuild(guild.id);
  } catch (error) {
    console.error(`تعذر تسجيل أوامر السلاش داخل السيرفر ${guild.id}:`, error);
  }
});

client.on('messageCreate', async message => {
  try {
    if (message.author.bot || !message.guild) return;

    const data = loadLevelProgress();
    const guildData = data[message.guild.id] || {};
    const progress = guildData[message.author.id] || {
      userId: message.author.id,
      messages: 0,
      voiceMinutes: 0,
      xp: 0,
      level: 0
    };

    const previousLevel = getLevelFromXp(Number(progress.xp || 0));
    progress.messages = Number(progress.messages || 0) + 1;
    const earnedMessageXp = 12 + Math.min(35, Math.floor((message.content || '').length / 18));
    progress.xp = Number(progress.xp || 0) + earnedMessageXp;
    progress.xp = Math.min(progress.xp, Number.MAX_SAFE_INTEGER);
    syncUserLevel(progress);
    guildData[message.author.id] = progress;
    data[message.guild.id] = guildData;
    saveLevelProgress(data);

    if (progress.level > previousLevel) {
      await announceLevelUp(message.guild.id, message.author.id, previousLevel, progress.level, progress.xp);
    }
  } catch (error) {
    console.error('تعذر تحديث XP الرسائل:', error);
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    const guildId = newState.guild.id;
    const memberId = newState.member?.id;
    if (!memberId || newState.member?.user?.bot) return;

    const key = `${guildId}:${memberId}`;
    const isJoining = !oldState.channelId && newState.channelId;
    const isSwitching = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
    const isLeaving = oldState.channelId && !newState.channelId;

    if (isJoining || isSwitching) {
      voiceTracking.set(key, Date.now());
      return;
    }

    if (isLeaving && voiceTracking.has(key)) {
      const startedAt = voiceTracking.get(key);
      const elapsedMs = Date.now() - startedAt;
      voiceTracking.delete(key);

      const minutes = elapsedMs / 60000;
      const data = loadLevelProgress();
      const guildData = data[guildId] || {};
      const progress = guildData[memberId] || {
        userId: memberId,
        messages: 0,
        voiceMinutes: 0,
        xp: 0,
        level: 0
      };

      const previousLevel = getLevelFromXp(Number(progress.xp || 0));
      progress.voiceMinutes = Number(progress.voiceMinutes || 0) + minutes;
      progress.xp = Number(progress.xp || 0) + Math.round(minutes * 8);
      progress.xp = Math.min(progress.xp, Number.MAX_SAFE_INTEGER);
      syncUserLevel(progress);
      guildData[memberId] = progress;
      data[guildId] = guildData;
      saveLevelProgress(data);

      if (progress.level > previousLevel) {
        await announceLevelUp(guildId, memberId, previousLevel, progress.level, progress.xp);
      }
    }
  } catch (error) {
    console.error('تعذر تحديث XP الصوت:', error);
  }
});

// استقبال التفاعلات (أوامر، أزرار، نماذج، قوائم)
client.on('interactionCreate', async interaction => {
  try {
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-panel') {
    if (!isAdministrator(interaction)) {
      return interaction.reply({ content: 'عذراً، هذا الأمر مخصص للإدارة فقط.', ephemeral: true });
    }

    const adminChannel = interaction.options.getChannel('admin-channel');
    const archiveChannel = interaction.options.getChannel('archive-channel');
    const publicChannel = interaction.options.getChannel('public-channel');
    if (!adminChannel || !archiveChannel || !publicChannel ||
      !isUsableTextChannel(adminChannel) || !isUsableTextChannel(archiveChannel) || !isUsableTextChannel(publicChannel)) {
      return interaction.reply({ content: 'حدد روم الإدارة والأرشيف والروم العام كلها ثم أعد المحاولة.', ephemeral: true });
    }

    const config = loadConfig();
    config[interaction.guildId] = {
      adminId: adminChannel.id,
      archiveId: archiveChannel.id,
      publicId: publicChannel.id,
      shortcuts: config[interaction.guildId]?.shortcuts || []
    };
    await saveConfig(config);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('btn_personal').setLabel('تعميم شخصي').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('btn_vehicle').setLabel('تعميم لوحة').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('btn_search').setLabel('بحث').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('btn_shortcuts').setLabel('الاختصارات').setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle('نظام التعميمات والبلاغات الرسمي')
      .setDescription('استخدم الأزرار أدناه لتقديم تعميم جديد أو للبحث في قاعدة البيانات.')
      .setColor(0x0099ff);

    await interaction.reply({ content: 'تم حفظ الإعدادات بنجاح وإرسال اللوحة!', ephemeral: true });
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'add-shortcut') {
    if (!isAdministrator(interaction)) {
      return interaction.reply({ content: 'عذراً، هذا الأمر مخصص للإدارة فقط.', ephemeral: true });
    }

    const name = interaction.options.getString('name', true).trim();
    const text = interaction.options.getString('text', true).trim();
    const config = loadConfig();
    const guildConfig = config[interaction.guildId] || {};
    const shortcuts = guildConfig.shortcuts || [];
    const existingShortcut = shortcuts.find(shortcut => normalizeSearchValue(shortcut.name) === normalizeSearchValue(name));

    if (existingShortcut) {
      existingShortcut.text = text;
    } else {
      shortcuts.push({ id: Date.now().toString(), name, text });
    }

    config[interaction.guildId] = { ...guildConfig, shortcuts };
    await saveConfig(config);
    return interaction.reply({ content: `تم حفظ الاختصار «${name}» بنجاح.`, ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'remove-shortcut') {
    if (!isAdministrator(interaction)) {
      return interaction.reply({ content: 'عذراً، هذا الأمر مخصص للإدارة فقط.', ephemeral: true });
    }

    const name = interaction.options.getString('name', true).trim();
    const config = loadConfig();
    const guildConfig = config[interaction.guildId] || {};
    const shortcuts = guildConfig.shortcuts || [];
    const shortcutIndex = shortcuts.findIndex(shortcut =>
      normalizeSearchValue(shortcut.name) === normalizeSearchValue(name)
    );

    if (shortcutIndex === -1) {
      return interaction.reply({ content: `لم يتم العثور على الاختصار «${name}».`, ephemeral: true });
    }

    shortcuts.splice(shortcutIndex, 1);
    config[interaction.guildId] = { ...guildConfig, shortcuts };
    await saveConfig(config);
    return interaction.reply({ content: `تم حذف الاختصار «${name}» بنجاح.`, ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'setup-levels') {
    if (!isAdministrator(interaction)) {
      return interaction.reply({ content: 'عذراً، هذا الأمر مخصص للإدارة فقط.', ephemeral: true });
    }

    const boardChannel = interaction.options.getChannel('board-channel');
    const announceChannel = interaction.options.getChannel('announce-channel');
    if (!boardChannel || !announceChannel || !isUsableTextChannel(boardChannel) || !isUsableTextChannel(announceChannel)) {
      return interaction.reply({ content: 'اختر روم اللوحة وروم التنبيهات بشكل صحيح.', ephemeral: true });
    }

    const config = loadLevelConfig();
    config[interaction.guildId] = {
      boardChannelId: boardChannel.id,
      announceChannelId: announceChannel.id,
      messageId: config[interaction.guildId]?.messageId || null,
      enabled: true
    };
    saveLevelConfig(config);
    await interaction.reply({ content: 'تم تفعيل لوحة النشاط والفل بنجاح.', ephemeral: true });
    await refreshLevelBoardForGuild(interaction.guildId);
    return;
  }

  if (interaction.isChatInputCommand() && interaction.commandName === 'rank') {
    const data = loadLevelProgress();
    const progress = (data[interaction.guildId] || {})[interaction.user.id] || {
      userId: interaction.user.id,
      messages: 0,
      voiceMinutes: 0,
      xp: 0,
      level: 0
    };

    const currentLevel = Math.min(MAX_LEVEL, Number(progress.level || getLevelFromXp(Number(progress.xp || 0))));
    const currentXp = Number(progress.xp || 0);
    const nextLevelXp = getLevelThreshold(currentLevel + 1);
    const bar = getProgressBar(currentXp, currentLevel);
    const embed = new EmbedBuilder()
      .setTitle(`🎖️ مستوى ${interaction.user.username}`)
      .setDescription(`اللقب: ${getLevelName(currentLevel)}`)
      .setColor(0x5865F2)
      .addFields(
        { name: 'فل الحالي', value: `${currentLevel}`, inline: true },
        { name: 'XP', value: `${currentXp.toLocaleString('en-US')}`, inline: true },
        { name: 'الرسائل', value: `${progress.messages || 0}`, inline: true },
        { name: 'الوقت الصوتي', value: `${(progress.voiceMinutes || 0).toFixed(1)} دقيقة`, inline: true },
        { name: 'التقدم', value: `${bar} \n${currentXp.toLocaleString('en-US')} / ${nextLevelXp.toLocaleString('en-US')} XP`, inline: false }
      )
      .setFooter({ text: `الفل الأعلى الممكن: ${MAX_LEVEL}` });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('approve_notice:') || interaction.customId.startsWith('reject_notice:')) {
      if (!isAdministrator(interaction)) {
        return interaction.reply({ content: 'عذراً، أزرار المراجعة مخصصة للإدارة فقط.', ephemeral: true });
      }

      const [action, noticeId] = interaction.customId.split(':');
      const notices = loadDB();
      const noticeIndex = notices.findIndex(notice => notice.id === noticeId);
      if (noticeIndex === -1) {
        return interaction.reply({ content: 'هذا التعميم غير موجود أو تمت معالجته مسبقاً.', ephemeral: true });
      }

      if (action === 'reject_notice') {
        notices.splice(noticeIndex, 1);
        await saveDB(notices);
        await interaction.deferReply({ ephemeral: true });
        await interaction.message.delete();
        return interaction.editReply('تم رفض التعميم وحذفه.');
      }

      const config = loadConfig();
      const guildConfig = config[interaction.guildId];
      const publicChannel = guildConfig?.publicId
        ? interaction.guild.channels.cache.get(guildConfig.publicId)
        : null;
      if (!publicChannel) {
        return interaction.reply({ content: 'لم يتم تحديد روم النشر العام. أعد تنفيذ /setup-panel.', ephemeral: true });
      }

      const notice = notices[noticeIndex];
      if (notice.status === 'approved') {
        return interaction.reply({ content: 'تمت معالجة هذا التعميم مسبقاً.', ephemeral: true });
      }

      notice.status = 'approved';
      await saveDB(notices);
      await publicChannel.send({
        embeds: [buildNoticeEmbed(notice)]
      });
      await interaction.update({ content: 'تم قبول التعميم ونشره في الروم العام.', components: [] });
      return;
    }

    if (interaction.customId === 'btn_personal') {
      const modal = new ModalBuilder().setCustomId('modal_personal').setTitle('نموذج تعميم شخصي');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_name').setLabel('الاسم').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_traits').setLabel('الصفات الجسدية').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_family').setLabel('اسم العائلة').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_extras').setLabel('الصورة | أيدي Discord (اختياري)').setPlaceholder('الرابط | 123456789012345678').setStyle(TextInputStyle.Short).setRequired(false))
      );
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'btn_vehicle') {
      const modal = new ModalBuilder().setCustomId('modal_vehicle').setTitle('نموذج تعميم لوحة مركبة');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_name').setLabel('اسم المالك').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_plate').setLabel('رقم اللوحة').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_discord_id').setLabel('أيدي Discord (اختياري)').setStyle(TextInputStyle.Short).setRequired(false)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_image').setLabel('رابط الصورة (اختياري)').setStyle(TextInputStyle.Short).setRequired(false))
      );
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'btn_search') {
      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('search_type_select')
          .setPlaceholder('اختر نوع البحث المطلوب')
          .addOptions([
            { label: 'البحث في التعميمات الشخصية', value: 'search_personal' },
            { label: 'البحث في تعميمات اللوحات', value: 'search_vehicle' },
            { label: 'البحث بأيدي Discord', value: 'search_discord_id' }
          ])
      );
      return await interaction.reply({ content: 'الرجاء تحديد نوع البحث:', components: [selectRow], ephemeral: true });
    }

    if (interaction.customId === 'btn_shortcuts') {
      const guildConfig = loadConfig()[interaction.guildId];
      const shortcuts = guildConfig?.shortcuts || [];
      if (shortcuts.length === 0) {
        return interaction.reply({ content: 'لا توجد اختصارات مضافة حالياً.', ephemeral: true });
      }

      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('shortcut_select')
          .setPlaceholder('اختر الاختصار المطلوب')
          .addOptions(shortcuts.slice(0, 25).map(shortcut => ({
            label: shortcut.name.slice(0, 100),
            value: shortcut.id
          })))
      );
      return interaction.reply({ content: 'اختر اختصاراً:', components: [selectRow], ephemeral: true });
    }
  }

  if (interaction.isModalSubmit()) {
    const config = loadConfig();
    const guildConfig = config[interaction.guildId];
    if (!guildConfig) return interaction.reply({ content: 'الرجاء تفعيل البوت أولاً عبر أمر /setup-panel', ephemeral: true });

    const notices = loadDB();

    if (interaction.customId === 'modal_search_vehicle' || interaction.customId === 'modal_search_personal' || interaction.customId === 'modal_search_discord_id') {
      const searchValue = normalizeSearchValue(interaction.fields.getTextInputValue('search_value'));
      if (!searchValue) {
        return interaction.reply({ content: 'اكتب قيمة صحيحة للبحث.', ephemeral: true });
      }
      const isVehicleSearch = interaction.customId === 'modal_search_vehicle';
      const isDiscordIdSearch = interaction.customId === 'modal_search_discord_id';
      const matches = notices.filter(notice => {
        if (notice.guildId !== interaction.guildId || (notice.status && notice.status !== 'approved')) return false;
        if (!isDiscordIdSearch && isVehicleSearch && notice.type !== 'vehicle') return false;
        if (!isDiscordIdSearch && !isVehicleSearch && notice.type !== 'personal') return false;
        const value = isDiscordIdSearch ? notice.discordId : (isVehicleSearch ? notice.plate : notice.name);
        return normalizeSearchValue(value).includes(searchValue);
      });

      if (matches.length === 0) {
        return interaction.reply({
          content: isDiscordIdSearch
            ? 'لا يوجد تعميم مرتبط بأيدي Discord هذا.'
            : (isVehicleSearch ? 'لا يوجد تعميم على رقم اللوحة هذا.' : 'لا يوجد تعميم على الاسم هذا.'),
          ephemeral: true
        });
      }

      const searchedAt = Date.now();
      matches.forEach(notice => { notice.lastSearched = searchedAt; });
      await saveDB(notices);

      return interaction.reply({
        content: `تم العثور على ${matches.length} تعميم.`,
        embeds: matches.slice(0, 10).map(notice => buildNoticeEmbed(notice)),
        ephemeral: true
      });
    }

    if (interaction.customId === 'modal_personal') {
      const name = interaction.fields.getTextInputValue('p_name');
      const traits = interaction.fields.getTextInputValue('p_traits');
      const family = interaction.fields.getTextInputValue('p_family');
      const reason = interaction.fields.getTextInputValue('p_reason');
      const extras = parsePersonalExtras(interaction.fields.getTextInputValue('p_extras'));
      const discordId = extras.discordId;
      const imageInput = extras.image;
      if (discordId && !/^\d{17,20}$/.test(discordId)) {
        return interaction.reply({ content: 'أيدي Discord غير صالح. أدخل الأيدي الرقمي فقط.', ephemeral: true });
      }
      let image = null;
      if (imageInput) {
        try {
          const imageUrl = new URL(imageInput);
          if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') throw new Error('رابط الصورة غير صالح.');
          if (isDiscordImageUrl(imageInput)) throw new Error('روابط Discord غير مسموحة. استخدم رابط صورة من موقع آخر.');
          image = await uploadImage(imageInput);
        } catch (error) {
          return interaction.reply({ content: `تعذر حفظ الصورة: ${error.message}`, ephemeral: true });
        }
      }

      const noticeData = {
        id: Date.now().toString(),
        guildId: interaction.guildId,
        status: 'pending',
        type: 'personal',
        author: interaction.user.tag,
        name, traits, family, reason, discordId, image,
        timestamp: Date.now(),
        lastSearched: Date.now()
      };
      notices.push(noticeData);
      await saveDB(notices);

      const adminChannel = interaction.guild.channels.cache.get(guildConfig.adminId);
      if (adminChannel) {
        await adminChannel.send({
          content: '**تعميم شخصي جديد بانتظار المراجعة**\nيرجى مراجعة البيانات والصورة ثم اختيار الإجراء:',
          embeds: [buildNoticeEmbed(noticeData)],
          components: [buildReviewButtons(noticeData.id)]
        });
      }

      return await interaction.reply({ content: 'تم إرسال التعميم الشخصي بنجاح لمراجعة الإدارة!', ephemeral: true });
    }

    if (interaction.customId === 'modal_vehicle') {
      const name = interaction.fields.getTextInputValue('v_name');
      const plate = interaction.fields.getTextInputValue('v_plate');
      const reason = interaction.fields.getTextInputValue('v_reason');
      const discordId = interaction.fields.getTextInputValue('v_discord_id').trim();
      const imageInput = interaction.fields.getTextInputValue('v_image').trim();
      if (discordId && !/^\d{17,20}$/.test(discordId)) {
        return interaction.reply({ content: 'أيدي Discord غير صالح. أدخل الأيدي الرقمي فقط.', ephemeral: true });
      }
      let image = null;
      if (imageInput) {
        try {
          const imageUrl = new URL(imageInput);
          if (imageUrl.protocol !== 'http:' && imageUrl.protocol !== 'https:') throw new Error('رابط الصورة غير صالح.');
          if (isDiscordImageUrl(imageInput)) throw new Error('روابط Discord غير مسموحة. استخدم رابط صورة من موقع آخر.');
          image = await uploadImage(imageInput);
        } catch (error) {
          return interaction.reply({ content: `تعذر حفظ الصورة: ${error.message}`, ephemeral: true });
        }
      }

      const noticeData = {
        id: Date.now().toString(),
        guildId: interaction.guildId,
        status: 'pending',
        type: 'vehicle',
        author: interaction.user.tag,
        name, plate, reason, discordId, image,
        timestamp: Date.now(),
        lastSearched: Date.now()
      };
      notices.push(noticeData);
      await saveDB(notices);

      const adminChannel = interaction.guild.channels.cache.get(guildConfig.adminId);
      if (adminChannel) {
        await adminChannel.send({
          content: '**تعميم لوحة جديد بانتظار المراجعة**\nيرجى مراجعة البيانات ثم اختيار الإجراء:',
          embeds: [buildNoticeEmbed(noticeData)],
          components: [buildReviewButtons(noticeData.id)]
        });
      }

      return await interaction.reply({ content: 'تم إرسال تعميم اللوحة بنجاح لمراجعة الإدارة!', ephemeral: true });
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'search_type_select') {
    const selected = interaction.values[0];

    if (selected === 'search_personal') {
      const modal = new ModalBuilder().setCustomId('modal_search_personal').setTitle('البحث عن تعميم شخصي');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('search_value').setLabel('اكتب الاسم').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      return await interaction.showModal(modal);
    }

    if (selected === 'search_vehicle') {
      const modal = new ModalBuilder().setCustomId('modal_search_vehicle').setTitle('البحث عن تعميم لوحة');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('search_value').setLabel('اكتب رقم اللوحة').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      return await interaction.showModal(modal);
    }

    if (selected === 'search_discord_id') {
      const modal = new ModalBuilder().setCustomId('modal_search_discord_id').setTitle('البحث بأيدي Discord');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('search_value').setLabel('اكتب أيدي Discord').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      return await interaction.showModal(modal);
    }
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'shortcut_select') {
    const guildConfig = loadConfig()[interaction.guildId];
    const shortcut = guildConfig?.shortcuts?.find(item => item.id === interaction.values[0]);
    if (!shortcut) {
      return interaction.update({ content: 'هذا الاختصار غير موجود أو تم حذفه.', components: [] });
    }

    return interaction.update({ content: shortcut.text, components: [] });
  }
  } catch (error) {
    console.error('حدث خطأ أثناء معالجة التفاعل:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'حدث خطأ غير متوقع. حاول مرة أخرى لاحقاً.', ephemeral: true }).catch(() => {});
    }
  }
});

setInterval(async () => {
  const notices = loadDB();
  const config = loadConfig();
  const now = Date.now();
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;

  let updatedNotices = [];
  for (let notice of notices) {
    if (notice.status === 'approved' && !notice.archivedAt &&
      now - (notice.lastSearched || notice.timestamp) > ONE_WEEK) {
      for (const guildId in config) {
        if (notice.guildId !== guildId) continue;
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const archiveChannel = guild.channels.cache.get(config[guildId].archiveId);
          if (isUsableTextChannel(archiveChannel)) {
            try {
              await archiveChannel.send({
                content: `[أرشيف تلقائي] تم نقل التعميم إلى الأرشيف: ${notice.name || notice.plate}`,
                embeds: [buildNoticeEmbed(notice)]
              });
              notice.archivedAt = now;
            } catch (error) {
              console.error('تعذر إرسال التعميم إلى الأرشيف:', error);
            }
          }
        }
      }
    }
    updatedNotices.push(notice);
  }
  await saveDB(updatedNotices);
}, 60 * 60 * 1000);

setInterval(async () => {
  const data = loadLevelProgress();
  for (const guild of client.guilds.cache.values()) {
    for (const [memberId, state] of voiceTracking.entries()) {
      if (!memberId.startsWith(`${guild.id}:`)) continue;
      const memberIdOnly = memberId.split(':')[1];
      const member = guild.members.cache.get(memberIdOnly);
      if (!member || member.user.bot) continue;

      const guildData = data[guild.id] || {};
      const progress = guildData[memberIdOnly] || {
        userId: memberIdOnly,
        messages: 0,
        voiceMinutes: 0,
        xp: 0,
        level: 0
      };

      const previousLevel = getLevelFromXp(Number(progress.xp || 0));
      progress.voiceMinutes = Number(progress.voiceMinutes || 0) + 1;
      progress.xp = Number(progress.xp || 0) + 8;
      syncUserLevel(progress);
      guildData[memberIdOnly] = progress;
      data[guild.id] = guildData;
      if (progress.level > previousLevel) {
        await announceLevelUp(guild.id, memberIdOnly, previousLevel, progress.level, progress.xp);
      }
    }
  }
  saveLevelProgress(data);
  await refreshAllLevelBoards().catch(error => {
    console.error('تعذر تحديث لوحة النشاط:', error);
  });
}, 60 * 1000);

client.login(TOKEN);