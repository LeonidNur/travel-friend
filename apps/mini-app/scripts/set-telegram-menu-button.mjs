import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const DEFAULT_BUTTON_TEXT = 'Travel Friend';
const TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const ENV_FILE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env.local');

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

function parseEnvFile(contents) {
  const entries = {};

  for (const rawLine of normalizeLineEndings(contents).split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }

    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries[key] = value;
  }

  return entries;
}

function readTelegramEnvFile(envFilePath = ENV_FILE_PATH) {
  try {
    return readFileSync(envFilePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Не найден файл .env.local: ${envFilePath}`);
    }

    throw error;
  }
}

export function buildMenuButton(webAppUrl) {
  return {
    type: 'web_app',
    text: DEFAULT_BUTTON_TEXT,
    web_app: {
      url: webAppUrl,
    },
  };
}

export function loadTelegramMenuButtonConfig(envFilePath = ENV_FILE_PATH) {
  const env = parseEnvFile(readTelegramEnvFile(envFilePath));
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const webAppUrl = env.TELEGRAM_WEB_APP_URL?.trim();
  const missingVariables = [];

  if (!botToken) {
    missingVariables.push('TELEGRAM_BOT_TOKEN');
  }

  if (!webAppUrl) {
    missingVariables.push('TELEGRAM_WEB_APP_URL');
  }

  if (missingVariables.length > 0) {
    throw new Error(
      `Не заданы обязательные переменные в .env.local: ${missingVariables.join(', ')}`,
    );
  }

  return { botToken, webAppUrl };
}

function redactToken(message, botToken) {
  if (!message) {
    return message;
  }

  return botToken ? message.split(botToken).join('[REDACTED]') : message;
}

async function setTelegramMenuButton({ botToken, webAppUrl, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${TELEGRAM_API_BASE_URL}/bot${botToken}/setChatMenuButton`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        menu_button: buildMenuButton(webAppUrl),
      }),
    },
  );

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.ok) {
    const description = payload?.description || `HTTP ${response.status}`;
    throw new Error(`Telegram Bot API вернул ошибку: ${description}`);
  }

  return payload.result;
}

export async function main({
  envFilePath = ENV_FILE_PATH,
  fetchImpl = fetch,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let botToken = '';

  try {
    const config = loadTelegramMenuButtonConfig(envFilePath);
    botToken = config.botToken;
    const { webAppUrl } = config;
    await setTelegramMenuButton({ botToken, webAppUrl, fetchImpl });
    stdout.write('Кнопка Mini App успешно настроена.\n');
    return 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Не удалось настроить кнопку Mini App.';
    stderr.write(`${redactToken(message, botToken)}\n`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
