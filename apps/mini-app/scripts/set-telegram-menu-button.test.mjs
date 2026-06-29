import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';

import {
  buildMenuButton,
  loadTelegramMenuButtonConfig,
  main,
} from './set-telegram-menu-button.mjs';

const createTempEnvFile = (contents) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'travel-friend-telegram-'));
  const envPath = path.join(dir, '.env.local');
  writeFileSync(envPath, contents, 'utf8');
  return { dir, envPath };
};

test('buildMenuButton creates a Telegram web app menu button', () => {
  assert.deepEqual(buildMenuButton('https://example.com/app'), {
    type: 'web_app',
    text: 'Travel Friend',
    web_app: { url: 'https://example.com/app' },
  });
});

test('loadTelegramMenuButtonConfig reads and validates .env.local', () => {
  const { dir, envPath } = createTempEnvFile(
    [
      '# comment',
      'TELEGRAM_BOT_TOKEN="123456:ABC-DEF"',
      'TELEGRAM_WEB_APP_URL=https://example.com/app',
      '',
    ].join('\n'),
  );

  try {
    assert.deepEqual(loadTelegramMenuButtonConfig(envPath), {
      botToken: '123456:ABC-DEF',
      webAppUrl: 'https://example.com/app',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main configures the Telegram menu button without leaking the token', async () => {
  const { dir, envPath } = createTempEnvFile(
    [
      'TELEGRAM_BOT_TOKEN=123456:ABC-DEF',
      'TELEGRAM_WEB_APP_URL=https://example.com/app',
      '',
    ].join('\n'),
  );

  const requests = [];
  const stdout = [];
  const stderr = [];

  const fetchImpl = async (url, init) => {
    requests.push({
      url,
      init: {
        ...init,
        headers: { ...init.headers },
      },
    });

    return {
      ok: true,
      json: async () => ({ ok: true, result: true }),
    };
  };

  const stream = {
    write: (chunk) => {
      stdout.push(String(chunk));
      return true;
    },
  };

  const errStream = {
    write: (chunk) => {
      stderr.push(String(chunk));
      return true;
    },
  };

  try {
    const exitCode = await main({
      envFilePath: envPath,
      fetchImpl,
      stdout: stream,
      stderr: errStream,
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr.join(''), '');
    assert.match(stdout.join(''), /успешно настроена/i);
    assert.doesNotMatch(stdout.join(''), /123456:ABC-DEF/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.telegram.org/bot123456:ABC-DEF/setChatMenuButton');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      menu_button: {
        type: 'web_app',
        text: 'Travel Friend',
        web_app: { url: 'https://example.com/app' },
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('main reports missing configuration safely', async () => {
  const { dir, envPath } = createTempEnvFile('TELEGRAM_WEB_APP_URL=https://example.com/app\n');
  const stdout = [];
  const stderr = [];

  try {
    const exitCode = await main({
      envFilePath: envPath,
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
      stdout: { write: (chunk) => (stdout.push(String(chunk)), true) },
      stderr: { write: (chunk) => (stderr.push(String(chunk)), true) },
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.join(''), /TELEGRAM_BOT_TOKEN/i);
    assert.doesNotMatch(stderr.join(''), /123456:ABC-DEF/);
    assert.equal(stdout.join(''), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
