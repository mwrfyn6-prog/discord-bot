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
  PermissionFlagsBits 
} = require('discord.js');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v2: cloudinary } = require('cloudinary');

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
const TOKEN = process.env.TOKEN;
// ضع أيدي السيرفر بين علامتي الاقتباس هنا.
const GUILD_ID = "1339621671480332392";

if (!TOKEN) {
  throw new Error('متغير TOKEN غير موجود. أضف توكن البوت إلى متغيرات البيئة (Environment) في موقع Render ثم أعد التشغيل.');
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
      option.setName('name').setDescription('اسم الاختصار المراد حذفه').setRequired(true).setMaxLength(100))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommandsForGuild(guildId) {
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log(`تم تسجيل أوامر السلاش داخل السيرفر ${guildId}`);
}

client.once('ready', async () => {
  console.log(`تم تسجيل الدخول بنجاح باسم ${client.user.tag}`);
  try {
    await initializeStorage();
    if (client.guilds.cache.size === 0) {
      throw new Error('لم ينضم البوت إلى أي سيرفر. أضفه بصلاحية applications.commands ثم أعد التشغيل.');
    }

    // إزالة النسخ العالمية القديمة حتى لا تظهر الأوامر مرتين.
    await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
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

client.login(TOKEN);
