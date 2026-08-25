import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, verificationCodeRegexAnyLocale, DEFAULT_LOCALE } from '../i18n.js';

describe('t()', () => {
  it('should return English translation for en locale', () => {
    assert.strictEqual(t('en', 'telegram.channel.saved'), '✅ Saved');
  });

  it('should return Russian translation for ru locale', () => {
    assert.strictEqual(t('ru', 'telegram.channel.saved'), '✅ Сохранено');
  });

  it('should interpolate {param} placeholders', () => {
    const result = t('en', 'telegram.register.confirmed', { discordTag: 'alice#1234' });
    assert.ok(result.includes('alice#1234'));
  });

  it('should return key as fallback for unknown key', () => {
    // Force an unknown key through the type system
    const key = 'nonexistent.key' as Parameters<typeof t>[1];
    assert.strictEqual(t('en', key), 'nonexistent.key');
  });

  it('should leave unmatched placeholders intact', () => {
    const result = t('en', 'telegram.register.sendCode', {});
    assert.ok(result.includes('{code}'));
  });
});

describe('verificationCodeRegexAnyLocale()', () => {
  it('should match Russian verification code prefix', () => {
    const regex = verificationCodeRegexAnyLocale();
    const match = 'КОД ПОДТВЕРЖДЕНИЯ: abc123'.match(regex);
    assert.ok(match);
    assert.strictEqual(match![1], 'abc123');
  });

  it('should match English verification code prefix', () => {
    const regex = verificationCodeRegexAnyLocale();
    const match = 'VERIFICATION CODE: xyz789'.match(regex);
    assert.ok(match);
    assert.strictEqual(match![1], 'xyz789');
  });

  it('should not match arbitrary text', () => {
    const regex = verificationCodeRegexAnyLocale();
    assert.strictEqual('Hello world'.match(regex), null);
  });

  it('should not match codes shorter than 4 characters', () => {
    const regex = verificationCodeRegexAnyLocale();
    assert.strictEqual('VERIFICATION CODE: ab'.match(regex), null);
  });
});

describe('DEFAULT_LOCALE', () => {
  it('should be English', () => {
    assert.strictEqual(DEFAULT_LOCALE, 'en');
  });
});
