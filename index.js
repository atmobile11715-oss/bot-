// index.js
// npm install discord.js@14
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// In-memory queues: map messageId -> { name, channelId, guildId, ownerId, list: [userId] }
const queues = new Map();

function buildQueueEmbed(q) {
  const embed = new EmbedBuilder()
    .setTitle(`คิว: ${q.name}`)
    .setColor(0x00AE86)
    .setFooter({ text: `สร้างโดย: <@${q.ownerId}> • ผู้ใช้ในคิว: ${q.list.length}` })
    .setTimestamp();

  if (q.list.length === 0) {
    embed.setDescription('ยังไม่มีผู้เข้าคิว — กดปุ่ม "Join" เพื่อเข้าคิว');
  } else {
    const lines = q.list.map((id, i) => `${i + 1}. <@${id}>`);
    embed.setDescription(lines.join('\n'));
  }
  return embed;
}

function buildActionRow(messageId) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`join:${messageId}`)
      .setLabel('Join')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`leave:${messageId}`)
      .setLabel('Leave')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`next:${messageId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Danger)
  );
  return row;
}

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const prefix = '!queue';
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === 'create') {
    const name = args.join(' ') || 'default';
    // Create placeholder embed & buttons; we need message.id to put into customIds,
    // so first send a temporary message then edit it with proper customIds.
    const temp = await message.channel.send({ content: 'กำลังสร้างคิว...' });

    // Initialize queue entry
    const q = { name, channelId: message.channel.id, guildId: message.guild.id, ownerId: message.author.id, list: [] };
    queues.set(temp.id, q);

    const embed = buildQueueEmbed(q);
    const row = buildActionRow(temp.id);

    await temp.edit({ content: null, embeds: [embed], components: [row] });
    await message.reply({ content: `สร้างคิว "${name}" เรียบร้อยแล้ว` });
  }

  if (cmd === 'status') {
    // แสดงสถานะคิวในข้อความที่อ้างถึง (optional)
    const ref = message.reference;
    if (!ref) {
      message.reply('ใช้การอ้างถึงข้อความของคิว หรือส่งคำสั่งในช่องที่มีคิว');
      return;
    }
    const msgId = ref.messageId;
    const q = queues.get(msgId);
    if (!q) {
      message.reply('ไม่พบคิวจากข้อความที่อ้างถึง');
      return;
    }
    const embed = buildQueueEmbed(q);
    message.channel.send({ embeds: [embed] });
  }

  // เพิ่มคำสั่ง next แบบใช้ข้อความ (สำหรับกรณีผู้ใช้ไม่ต้องการปุ่ม)
  if (cmd === 'next') {
    // ค้นหาคิวที่ผู้ใช้สร้างไว้ในช่องนี้
    const found = Array.from(queues.entries()).map(([id, q]) => ({ id, q })).find(x => x.q.channelId === message.channel.id);
    if (!found) {
      message.reply('ไม่พบคิวในช่องนี้');
      return;
    }
    const { id: msgId, q } = found;
    // ตรวจสิทธิ์: เจ้าของคิว หรือผู้มี ManageGuild
    if (message.author.id !== q.ownerId && !message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      message.reply('ไม่มีสิทธิ์เรียกคนถัดไป (ต้องเป็นเจ้าของคิวหรือมี Manage Guild)');
      return;
    }
    if (q.list.length === 0) {
      message.reply('คิวว่างแล้ว');
      return;
    }
    const nextUser = q.list.shift(); // นำคนแรกออก
    // แจ้งผล
    message.channel.send(`เรียกคิว: <@${nextUser}>`);
    // อัพเดต embed ที่เป็นข้อความคิว
    try {
      const queueMessage = await message.channel.messages.fetch(msgId);
      const embed = buildQueueEmbed(q);
      const row = buildActionRow(msgId);
      await queueMessage.edit({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('ไม่สามารถอัปเดตข้อความคิว:', err);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const [action, messageId] = interaction.customId.split(':');
  const q = queues.get(messageId);
  if (!q) {
    await interaction.reply({ content: 'คิวไม่พบหรือหมดอายุ', ephemeral: true });
    return;
  }

  const userId = interaction.user.id;

  if (action === 'join') {
    if (q.list.includes(userId)) {
      await interaction.reply({ content: 'คุณอยู่ในคิวแล้ว', ephemeral: true });
      return;
    }
    q.list.push(userId);
    // update embed
    const embed = buildQueueEmbed(q);
    const row = buildActionRow(messageId);
    await interaction.update({ embeds: [embed], components: [row] });
  }

  if (action === 'leave') {
    const idx = q.list.indexOf(userId);
    if (idx === -1) {
      await interaction.reply({ content: 'คุณไม่ได้อยู่ในคิว', ephemeral: true });
      return;
    }
    q.list.splice(idx, 1);
    const embed = buildQueueEmbed(q);
    const row = buildActionRow(messageId);
    await interaction.update({ embeds: [embed], components: [row] });
  }

  if (action === 'next') {
    // ตรวจสิทธิ์: เจ้าของคิว หรือผู้มี ManageGuild
    const member = await interaction.guild.members.fetch(userId);
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.ManageGuild);
    if (interaction.user.id !== q.ownerId && !isAdmin) {
      await interaction.reply({ content: 'คุณไม่มีสิทธิ์เรียกคนถัดไป', ephemeral: true });
      return;
    }
    if (q.list.length === 0) {
      await interaction.reply({ content: 'คิวว่างแล้ว', ephemeral: true });
      return;
    }
    const nextUser = q.list.shift();
    // แจ้งในช่องว่าเรียกใคร
    try {
      const queueMessage = await interaction.channel.messages.fetch(messageId);
      const embed = buildQueueEmbed(q);
      const row = buildActionRow(messageId);
      await queueMessage.edit({ embeds: [embed], components: [row] });
      await interaction.reply({ content: `เรียกคิว: <@${nextUser}>` });
    } catch (err) {
      console.error('ไม่สามารถอัปเดตข้อความคิว:', err);
      await interaction.reply({ content: 'เกิดข้อผิดพลาดในการเรียกคิว', ephemeral: true });
    }
  }
});

client.once('ready', () => {
  console.log(`Ready: ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
