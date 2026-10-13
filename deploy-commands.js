// deploy-commands.js
// ใช้เพื่อลงทะเบียนคำสั่งสแลชแบบ guild (รวดเร็วสำหรับการพัฒนา)
import { REST, Routes } from 'discord.js';
import fs from 'fs';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId) {
  console.error('ต้องกำหนด DISCORD_TOKEN, CLIENT_ID, GUILD_ID เป็น environment variables');
  process.exit(1);
}

const commands = [
  {
    name: 'reserve',
    name_localizations: { th: 'จองคิว' },
    description: 'Create a timed queue (จองคิว)',
    description_localizations: { th: 'สร้างคิวที่เปิดตามเวลา' },
    options: [
      {
        name: 'name',
        name_localizations: { th: 'ชื่อคิว' },
        description: 'ชื่อคิว (เช่น บริการลูกค้า)',
        description_localizations: { th: 'ชื่อคิว' },
        type: 3, // STRING
        required: true
      },
      {
        name: 'max_slots',
        name_localizations: { th: 'จำนวนคน (max)' },
        description: 'จำนวนคนสูงสุดในคิว',
        type: 4, // INTEGER
        required: true
      },
      {
        name: 'start_in_minutes',
        name_localizations: { th: 'หน่วงเวลา (นาที)' },
        description: 'จะเปิดรับหลังจากกี่นาที (0 = เปิดทันที)',
        type: 4, // INTEGER
        required: false
      },
      {
        name: 'message',
        name_localizations: { th: 'ข้อความ' },
        description: 'ข้อความอธิบายคิว (optional)',
        type: 3, // STRING
        required: false
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('ลงทะเบียนคำสั่ง (guild)...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('เสร็จสิ้น: คำสั่งลงทะเบียนเรียบร้อย');
  } catch (err) {
    console.error('ไม่สามารถลงทะเบียนคำสั่งได้:', err);
  }
})();
