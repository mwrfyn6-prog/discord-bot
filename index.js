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

// ملف تخزين البيانات المحاكي (قاعدة بيانات محلية)
const DB_FILE = path.join(__dirname, 'notices_db.json');
const CONFIG_FILE = path.join(__dirname, 'config_db.json');

function loadDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    const notices = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return Array.isArray(notices)
      ? notices.map(notice => ({ guildId: GUILD_ID, status: 'approved', ...notice }))
      : [];
  } catch (e) { return []; }
}
function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

function buildNoticeEmbed(notice) {
  const embed = new EmbedBuilder()
    .setTitle(notice.type === 'personal' ? 'تعميم شخصي' : 'تعميم لوحة مركبة')
    .setColor(notice.type === 'personal' ? 0xff0000 : 0xffaa00)
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
      { name: 'المُبلغ', value: notice.author }
    );

  if (notice.image) embed.setImage(notice.image);
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
      option.setName('text').setDescription('النص الجاهز للاختصار').setRequired(true).setMaxLength(1500))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerCommandsForGuild(guildId) {
  await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commands });
  console.log(`تم تسجيل أوامر السلاش داخل السيرفر ${guildId}`);
}

client.once('ready', async () => {
  console.log(`تم تسجيل الدخول بنجاح باسم ${client.user.tag}`);
  try {
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
    saveConfig(config);

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
    saveConfig(config);
    return interaction.reply({ content: `تم حفظ الاختصار «${name}» بنجاح.`, ephemeral: true });
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
        saveDB(notices);
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
      saveDB(notices);
      await publicChannel.send({ embeds: [buildNoticeEmbed(notice)] });
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
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('p_image').setLabel('رابط الصورة (اختياري)').setStyle(TextInputStyle.Short).setRequired(false))
      );
      return await interaction.showModal(modal);
    }

    if (interaction.customId === 'btn_vehicle') {
      const modal = new ModalBuilder().setCustomId('modal_vehicle').setTitle('نموذج تعميم لوحة مركبة');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_name').setLabel('اسم المالك').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_plate').setLabel('رقم اللوحة').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('v_reason').setLabel('السبب').setStyle(TextInputStyle.Paragraph).setRequired(true))
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
            { label: 'البحث في تعميمات اللوحات', value: 'search_vehicle' }
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

    if (interaction.customId === 'modal_search_vehicle' || interaction.customId === 'modal_search_personal') {
      const searchValue = normalizeSearchValue(interaction.fields.getTextInputValue('search_value'));
      if (!searchValue) {
        return interaction.reply({ content: 'اكتب قيمة صحيحة للبحث.', ephemeral: true });
      }
      const isVehicleSearch = interaction.customId === 'modal_search_vehicle';
      const matches = notices.filter(notice => {
        if (notice.guildId !== interaction.guildId || (notice.status && notice.status !== 'approved')) return false;
        if (isVehicleSearch && notice.type !== 'vehicle') return false;
        if (!isVehicleSearch && notice.type !== 'personal') return false;
        const value = isVehicleSearch ? notice.plate : notice.name;
        return normalizeSearchValue(value).includes(searchValue);
      });

      if (matches.length === 0) {
        return interaction.reply({
          content: isVehicleSearch ? 'لا يوجد تعميم على رقم اللوحة هذا.' : 'لا يوجد تعميم على الاسم هذا.',
          ephemeral: true
        });
      }

      const searchedAt = Date.now();
      matches.forEach(notice => { notice.lastSearched = searchedAt; });
      saveDB(notices);

      return interaction.reply({
        content: matches.map(notice => isVehicleSearch
          ? `**المالك:** ${notice.name}\n**اللوحة:** ${notice.plate}\n**السبب:** ${notice.reason}`
          : `**الاسم:** ${notice.name} ${notice.family}\n**السبب:** ${notice.reason}`
        ).join('\n\n'),
        ephemeral: true
      });
    }

    if (interaction.customId === 'modal_personal') {
      const name = interaction.fields.getTextInputValue('p_name');
      const traits = interaction.fields.getTextInputValue('p_traits');
      const family = interaction.fields.getTextInputValue('p_family');
      const reason = interaction.fields.getTextInputValue('p_reason');
      const imageInput = interaction.fields.getTextInputValue('p_image').trim();
      let image = null;
      if (imageInput) {
        try {
          const imageUrl = new URL(imageInput);
          if (imageUrl.protocol === 'http:' || imageUrl.protocol === 'https:') image = imageInput;
        } catch {}
      }

      const noticeData = {
        id: Date.now().toString(),
        guildId: interaction.guildId,
        status: 'pending',
        type: 'personal',
        author: interaction.user.tag,
        name, traits, family, reason, image,
        timestamp: Date.now(),
        lastSearched: Date.now()
      };
      notices.push(noticeData);
      saveDB(notices);

      const adminChannel = interaction.guild.channels.cache.get(guildConfig.adminId);
      if (adminChannel) {
        await adminChannel.send({
          content: 'تعميم جديد بانتظار مراجعة الإدارة:',
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

      const noticeData = {
        id: Date.now().toString(),
        guildId: interaction.guildId,
        status: 'pending',
        type: 'vehicle',
        author: interaction.user.tag,
        name, plate, reason,
        timestamp: Date.now(),
        lastSearched: Date.now()
      };
      notices.push(noticeData);
      saveDB(notices);

      const adminChannel = interaction.guild.channels.cache.get(guildConfig.adminId);
      if (adminChannel) {
        await adminChannel.send({
          content: 'تعميم جديد بانتظار مراجعة الإدارة:',
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
    if (now - (notice.lastSearched || notice.timestamp) > ONE_WEEK) {
      for (const guildId in config) {
        if (notice.guildId !== guildId) continue;
        const guild = client.guilds.cache.get(guildId);
        if (guild) {
          const archiveChannel = guild.channels.cache.get(config[guildId].archiveId);
          if (isUsableTextChannel(archiveChannel)) {
            archiveChannel.send({
              content: `[أرشيف تلقائي] انتهت صلاحية التعميم الخاص بـ: ${notice.name || notice.plate}`,
              embeds: [buildNoticeEmbed(notice)]
            }).catch(error => console.error('تعذر إرسال التعميم إلى الأرشيف:', error));
          }
        }
      }
    } else {
      updatedNotices.push(notice);
    }
  }
  saveDB(updatedNotices);
}, 60 * 60 * 1000);

client.login(TOKEN);
