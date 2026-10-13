// index.js
import fs from 'fs';
import { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Please set DISCORD_TOKEN env variable');
  process.exit(1);
}

const DATA_FILE = './queues.json';

function loadQueues() {
  try {
    if (!fs.existsSync(DATA_FILE)) return {};
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (err) {
    console.error('Failed to load queues:', err);
    return {};
  }
}

function saveQueues(qs) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(qs, null, 2));
  } catch (err) {
    console.error('Failed to save queues:', err);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel]
});

let queues = loadQueues(); // { queueId: { ... } }

function makeEmbed(q) {
  const embed = new EmbedBuilder()
    .setTitle(`คิว: ${q.name}`)
    .setColor(0x00AE86)
    .setTimestamp();

  embed.setFooter({ text: `สร้างโดย: <@${q.ownerId}> • สถานะ: ${q.isOpen ? 'เปิด' : 'ปิด'} • ผู้ในคิว: ${q.list.length}/${q.maxSlots}` });

  const desc = [];
  if (q.message) desc.push(q.message);
  desc.push('\n');
  if (q.list.length === 0) {
    desc.push('ยังไม่มีผู้เข้าคิว');
  } else {
    q.list.forEach((id, i) => {
      desc.push(`${i + 1}. <@${id}>`);
    });
  }
  embed.setDescription(desc.join('\n'));
  return embed;
}

function makeButtons(q) {
  const disabled = !q.isOpen;
  const join = new ButtonBuilder().setCustomId(`join_${q.id}`).setLabel('เข้าคิว').setStyle(ButtonStyle.Success).setDisabled(disabled);
  const leave = new ButtonBuilder().setCustomId(`leave_${q.id}`).setLabel('ยกเลิก').setStyle(ButtonStyle.Secondary).setDisabled(false);
  const cancel = new ButtonBuilder().setCustomId(`cancel_${q.id}`).setLabel('ยกเลิกคิว').setStyle(ButtonStyle.Danger).setDisabled(false);
  const row = new ActionRowBuilder().addComponents(join, leave, cancel);
  return row;
}

async function scheduleOpen(q) {
  // ensure not already opened
  if (q.isOpen) return;
  const now = Date.now();
  if (q.startAt <= now) {
    // open immediately
    q.isOpen = true;
    saveQueues(queues);
    await updateQueueMessage(q);
    return;
  }
  const delay = q.startAt - now;
  setTimeout(async () => {
    // if already closed by being full, do nothing
    if (q.isOpen) return;
    if (q.list.length >= q.maxSlots) {
      q.isOpen = false;
      saveQueues(queues);
      await updateQueueMessage(q);
      return;
    }
    q.isOpen = true;
    saveQueues(queues);
    await updateQueueMessage(q);
  }, delay);
}

async function updateQueueMessage(q) {
  try {
    const channel = await client.channels.fetch(q.channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(q.messageId);
    if (!msg) return;
    await msg.edit({ embeds: [makeEmbed(q)], components: [makeButtons(q)] });
  } catch (err) {
    console.error('Failed to update queue message:', err);
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Ready as ${client.user.tag}`);
  // schedule pending queues
  for (const id of Object.keys(queues)) {
    const q = queues[id];
    // if queue was open already, ensure buttons enabled
    if (q.isOpen) {
      updateQueueMessage(q);
    } else {
      scheduleOpen(q);
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isCommand()) {
      if (interaction.commandName === 'reserve') {
        const name = interaction.options.getString('name');
        const maxSlots = interaction.options.getInteger('max_slots');
        const startIn = interaction.options.getInteger('start_in_minutes') || 0;
        const message = interaction.options.getString('message') || '';
        const startAt = Date.now() + startIn * 60 * 1000;

        // create queue object
        const id = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const q = {
          id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: null,
          ownerId: interaction.user.id,
          name,
          message,
          maxSlots,
          startAt,
          isOpen: false,
          list: []
        };

        // send initial message with disabled buttons (if startIn > 0) or enabled when startIn === 0
        const sent = await interaction.reply({ embeds: [makeEmbed(q)], components: [makeButtons(q)], fetchReply: true });
        q.messageId = sent.id;
        queues[q.id] = q;
        saveQueues(queues);

        // schedule open
        if (startIn <= 0) {
          q.isOpen = true;
          saveQueues(queues);
          await updateQueueMessage(q);
        } else {
          scheduleOpen(q);
        }

        await interaction.followUp({ content: `สร้างคิว "${name}" เรียบร้อย (เปิดรับใน ${startIn} นาที)`, ephemeral: true });
      }
    } else if (interaction.isButton()) {
      const [action, qid] = interaction.customId.split('_');
      const q = queues[qid];
      if (!q) {
        await interaction.reply({ content: 'ไม่พบคิวหรือคิวหมดอายุ', ephemeral: true });
        return;
      }

      if (action === 'join') {
        if (!q.isOpen) {
          await interaction.reply({ content: 'ยังไม่เปิดรับ หรือคิวปิดแล้ว', ephemeral: true });
          return;
        }
        if (q.list.includes(interaction.user.id)) {
          await interaction.reply({ content: `คุณอยู่ในคิวแล้ว ตำแหน่งของคุณ: ${q.list.indexOf(interaction.user.id) + 1}`, ephemeral: true });
          return;
        }
        if (q.list.length >= q.maxSlots) {
          q.isOpen = false;
          saveQueues(queues);
          await updateQueueMessage(q);
          await interaction.reply({ content: 'คิวเต็มแล้ว', ephemeral: true });
          return;
        }
        q.list.push(interaction.user.id);
        saveQueues(queues);
        await updateQueueMessage(q);
        await interaction.reply({ content: `จองเรียบร้อย คุณเป็นคิวที่ ${q.list.length}`, ephemeral: true });

        // if reached max, close immediately
        if (q.list.length >= q.maxSlots) {
          q.isOpen = false;
          saveQueues(queues);
          await updateQueueMessage(q);
          try {
            const channel = await client.channels.fetch(q.channelId);
            await channel.send(`คิว "${q.name}" ถูกปิดโดยอัตโนมัติเนื่องจากคนเต็ม`);
          } catch (e) { /* ignore */ }
        }
      } else if (action === 'leave') {
        const idx = q.list.indexOf(interaction.user.id);
        if (idx === -1) {
          await interaction.reply({ content: 'คุณไม่ได้อยู่ในคิว', ephemeral: true });
          return;
        }
        q.list.splice(idx, 1);
        saveQueues(queues);
        await updateQueueMessage(q);
        await interaction.reply({ content: 'คุณได้ออกจากคิวแล้ว', ephemeral: true });
      } else if (action === 'cancel') {
        // only owner can cancel
        if (interaction.user.id !== q.ownerId) {
          await interaction.reply({ content: 'เฉพาะผู้สร้างคิวเท่านั้นที่ยกเลิกได้', ephemeral: true });
          return;
        }
        // edit message to disabled and mark closed
        q.isOpen = false;
        saveQueues(queues);
        await updateQueueMessage(q);
        await interaction.reply({ content: 'ยกเลิกคิวเรียบร้อย', ephemeral: true });
      }
    }
  } catch (err) {
    console.error('Interaction handler error:', err);
    if (interaction && !interaction.replied) {
      try { await interaction.reply({ content: 'เกิดข้อผิดพลาด', ephemeral: true }); } catch (e) {}
    }
  }
});

client.login(token);
