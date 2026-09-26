# Supabase database backup

This script backs up only the **live Supabase project
`bcsdqkjzobllocejfcdz`**. It never uses `.env` database URLs, the native backend,
local Docker databases, or a changed CLI project link. The source project is
fixed in the script; there is no source-selection option.

Run from the repository root after installing dependencies and authenticating
the Supabase CLI (`npx supabase login`). Docker Desktop must be running only to
run the export utility, not as a database source. The installed CLI is reused;
the script does not download another one.

```powershell
npm run db:backup
```

The default destination is `C:\dev\db-backup`. Every run creates a new folder
named with the live project reference, UTC timestamp, and unique ID. You can
change the destination explicitly:

```powershell
npm run db:backup -- --output-dir C:\dev\db-backup
```

The script restricts the run folder to the current Windows account, SYSTEM and
Administrators before exporting. On other systems it uses owner-only directory
and file permissions; supply an absolute `--output-dir` on those systems.
Backups inside the repository, including symlink-resolved paths, are rejected.

Each completed folder contains:

- `roles.sql`: non-reserved roles; custom login-role passwords are excluded.
- `schema.sql`: application schema, including functions, triggers and RLS.
- `data.sql`: application data and Auth/Storage database rows, using COPY.
- `history-schema.sql` / `history-data.sql`: Supabase CLI migration history.
- `auth-storage-schema.sql`: managed-schema reference copy, including custom
  triggers; do not blindly restore platform objects into an existing project.
- `manifest.json`: project, CLI version, export times, byte counts and SHA-256
  checksums; `restoreVerified` remains false.

The source is only read; the script does not apply migrations, fence writers,
restore data or delete older backups. Failed/interrupted exports remain in a
`.partial` folder and must not be treated as completed backups. Nonzero CLI
exits or empty/missing exports prevent publication. CLI diagnostics are withheld
because they may contain credentials.

Do not run schema migrations during the backup: the files are exported
sequentially and do not share a single snapshot. Wait for success before pushing
migrations. Export completion and checksums do not prove recovery: validate the
restore in a disposable, compatible Supabase environment before relying on it.

Storage object files, platform/Auth configuration, API/JWT secrets, Vault
secrets and deployed Edge Functions are not included. SQL files can contain
password hashes and session tokens; keep the destination private and use an
encrypted disk. No automatic retention/deletion is performed.

See the official [CLI backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
