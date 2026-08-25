import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../i18n.js';
import { formatMentionMessage } from '../discord.js';
import { Collection } from 'discord.js';
import type { Message, User, Guild, TextChannel } from 'discord.js';

function createMockMessage(overrides: {
  content: string;
  authorDisplayName: string;
  authorTag: string;
  guildName: string;
  channelName: string;
  mentions?: Map<string, { id: string; displayName: string; tag: string }>;
}): Message {
  const mentionUsers = new Collection<string, User>();
  if (overrides.mentions) {
    for (const [id, data] of overrides.mentions) {
      mentionUsers.set(id, {
        id: data.id,
        displayName: data.displayName,
        tag: data.tag,
      } as User);
    }
  }

  return {
    content: overrides.content,
    author: {
      displayName: overrides.authorDisplayName,
      tag: overrides.authorTag,
    },
    guild: {
      name: overrides.guildName,
    } as Guild,
    channel: {
      name: overrides.channelName,
      isTextBased: () => true,
    } as TextChannel,
    mentions: {
      users: mentionUsers,
    },
  } as unknown as Message;
}

describe('formatMentionMessage', () => {
  it('should format basic notification correctly (ru)', () => {
    const msg = createMockMessage({
      content: 'Hey <@123> check this',
      authorDisplayName: 'Alice',
      authorTag: 'alice#1234',
      guildName: 'MyServer',
      channelName: 'general',
      mentions: new Map([['123', { id: '123', displayName: 'Bob', tag: 'bob#5678' }]]),
    });

    const result = formatMentionMessage(msg, 'ru');

    assert.ok(result.includes(t('ru', 'discord.mention.title')));
    assert.ok(result.includes('MyServer#general'));
    assert.ok(result.includes('Alice(alice#1234)'));
    assert.ok(result.includes('@Bob(bob#5678)'));
    assert.ok(!result.includes('<@123>'));
  });

  it('should format basic notification correctly (en)', () => {
    const msg = createMockMessage({
      content: 'Hey <@123> check this',
      authorDisplayName: 'Alice',
      authorTag: 'alice#1234',
      guildName: 'MyServer',
      channelName: 'general',
      mentions: new Map([['123', { id: '123', displayName: 'Bob', tag: 'bob#5678' }]]),
    });

    const result = formatMentionMessage(msg, 'en');

    assert.ok(result.includes(t('en', 'discord.mention.title')));
    assert.ok(result.includes('MyServer#general'));
  });

  it('should handle multiple mentions', () => {
    const msg = createMockMessage({
      content: '<@111> and <@222> please review',
      authorDisplayName: 'Charlie',
      authorTag: 'charlie#0001',
      guildName: 'DevServer',
      channelName: 'code-review',
      mentions: new Map([
        ['111', { id: '111', displayName: 'Dave', tag: 'dave#1111' }],
        ['222', { id: '222', displayName: 'Eve', tag: 'eve#2222' }],
      ]),
    });

    const result = formatMentionMessage(msg, 'en');

    assert.ok(result.includes('@Dave(dave#1111)'));
    assert.ok(result.includes('@Eve(eve#2222)'));
    assert.ok(!result.includes('<@111>'));
    assert.ok(!result.includes('<@222>'));
  });

  it('should handle nickname mentions (<!@id>)', () => {
    const msg = createMockMessage({
      content: 'Hey <@!123> look',
      authorDisplayName: 'Alice',
      authorTag: 'alice#1234',
      guildName: 'Server',
      channelName: 'chat',
      mentions: new Map([['123', { id: '123', displayName: 'Bob', tag: 'bob#5678' }]]),
    });

    const result = formatMentionMessage(msg, 'ru');
    assert.ok(result.includes('@Bob(bob#5678)'));
    assert.ok(!result.includes('<@!123>'));
  });

  it('should produce correct multi-line format', () => {
    const msg = createMockMessage({
      content: 'Hello world',
      authorDisplayName: 'User',
      authorTag: 'user#0000',
      guildName: 'Guild',
      channelName: 'channel',
    });

    const lines = formatMentionMessage(msg, 'ru').split('\n');

    assert.strictEqual(lines[0], t('ru', 'discord.mention.title'));
    assert.strictEqual(lines[1], 'Guild#channel');
    assert.strictEqual(lines[2], '');
    assert.strictEqual(lines[3], 'User(user#0000): Hello world');
  });
});
