// Task metadata for the local reminders/jobs dashboard.
// This is intentionally file-based (not DB) and can be edited by hand.

export const TASK_META = {
  // Work
  'dc81eff8-95d1-4b98-85c8-26a6d122c8be': {
    type: 'work',
    title: '@1024EX 新帖同步（15m）',
    targets: [
      { channel: 'telegram', target: '412432207', label: 'TG 私聊' },
      { channel: 'telegram', target: '-5289849700', label: 'TG 群' },
    ],
  },
  '5175eb16-d719-4d17-acf2-5e5df872c0ef': {
    type: 'work',
    title: '@1024EX 满24h评论抓取&分析（每小时）',
    targets: [
      { channel: 'telegram', target: '412432207', label: 'TG 私聊' },
      { channel: 'telegram', target: '-5289849700', label: 'TG 群' },
    ],
  },
  '3c50812c-d10b-45ff-868e-49a92ac250de': {
    type: 'work',
    title: 'Discord 讨论摘要（每8h）',
    targets: [
      { channel: 'telegram', target: '412432207', label: 'TG 私聊' },
      { channel: 'telegram', target: '-5289849700', label: 'TG 群' },
    ],
  },
  'dc5527e8-5a9d-4b50-90f3-bde4b5981020': {
    type: 'work',
    title: '每月节日整理提醒',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },

  // Life
  'd08d0066-2460-47ab-98eb-8a8b8f15d4d5': {
    type: 'life',
    title: '每日自检（11:00/21:00）',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },
  '343f05bc-e36f-41ec-b38c-7a80ba137d30': {
    type: 'life',
    title: '北京天气（每日09:00）',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },
  '254be045-94ab-4a81-86b0-74eca9894671': {
    type: 'life',
    title: '水电费&话费提醒（月度）',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },
  '0ab8c62b-7547-4428-9d9f-98195638e48e': {
    type: 'life',
    title: '导出 ChatGPT 数据（月度）',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },
  'bd2b6800-fd6d-4acb-a69c-4843665ffb0a': {
    type: 'life',
    title: '一帆生日预告（一次性）',
    targets: [{ channel: 'telegram', target: '412432207', label: 'TG 私聊' }],
  },
};
