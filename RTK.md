# RTK

Prefix every shell command with `rtk`: `rtk git status`, `rtk npm run build`,
and `rtk rg "pattern"`. Keep the prefix inside command chains:
`rtk git add . && rtk git commit -m "msg"`.

Commands RTK does not filter run normally through the proxy, so the prefix is
safe for every shell command.

## Command output

RTK condenses command output to preserve relevant signals while reducing noise.
Treat its output as complete. Re-run a command as `rtk proxy <command>` only
when RTK's result is unusable: empty when output was expected, inconsistent
with its exit code, or garbled.

Batch related commands in one shell invocation when their results are
independent.

## Useful commands

- `rtk gain` or `rtk gain --history` shows token savings.
- `rtk discover` identifies earlier commands RTK could have condensed.
- `RTK_DISABLED=1 <command>` runs one command without RTK.
