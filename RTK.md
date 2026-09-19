# RTK

Prefer `rtk` for supported external commands with noisy output, such as
`rtk git status` and `rtk npm run build`. In a chain, prefix each supported
command separately. Run PowerShell cmdlets, functions, and aliases directly;
RTK cannot launch `Get-Content` as an executable. If RTK fails to initialize,
run the original command directly.

## Command output

Command output here is condensed to save tokens, keeping every signal and
dropping costly noise. Treat it as the complete result when the command
succeeds, and batch related commands into one call to avoid extra turns.
Truncated results state their recovery path in their own output. If filtered
output is unusable, run `rtk proxy <external-command>` when RTK is available.
Otherwise run the original command directly.

## About RTK

RTK (Rust Token Killer) is a CLI proxy that filters command output to save
tokens; behavior and exit code are unchanged.

- `rtk gain` / `rtk gain --history` — token savings, overall and per command.
- `rtk proxy <external-command>` — run a command unfiltered, still tracked.
- `rtk discover` — find past commands RTK could have condensed.
