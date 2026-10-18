const fs = require('fs');
const path = require('path');

// Repo root first, then mobile/; .env.local before .env. The first file to set a key wins.
const DEFAULT_ENV_FILES = [
  path.resolve(__dirname, '..', '..', '.env.local'),
  path.resolve(__dirname, '..', '.env.local'),
  path.resolve(__dirname, '..', '..', '.env'),
  path.resolve(__dirname, '..', '.env'),
];

/**
 * Fill unset keys in `env` from local env files so packaging scripts can find
 * signing settings without exporting them in every shell. Values already in
 * the environment always win; unreadable files are skipped.
 */
function loadEnvDefaults(env = process.env, files = DEFAULT_ENV_FILES) {
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
      if (!env[key]) env[key] = value;
    }
  }
  return env;
}

module.exports = { loadEnvDefaults, DEFAULT_ENV_FILES };
