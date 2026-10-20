# Windows signer selection — 2026-10-03

Decision: select exactly one non-CA Code Signing certificate from the configured
PFX whose subject matches the package manifest Publisher, and pass its thumbprint
to MSBuild. Keep the existing PFX/password environment workflow and unsigned mode.

FACT: the screenshot reports APPX1204 / multiple matching certificates and lists
CN=VSIS plus its root CA. `package-windows.js:ensureCertificate` returns an empty
thumbprint, so its existing PackageCertificateThumbprint branch never executes.
FACT: the manifest Publisher is CN=VSIS. Get-PfxData reads end-entity and chain
certificate metadata without installing certificates
([Microsoft PKI documentation](https://learn.microsoft.com/en-us/powershell/module/pki/get-pfxdata?view=windowsserver2025-ps)).

Selected: read metadata through built-in Windows PowerShell, filter by exact
Publisher, non-CA basic constraints and explicit Code Signing EKU, and pin the
unique thumbprint. An optional WINDOWS_CERT_THUMBPRINT narrows multiple valid
leaf candidates but must still match the same filters. Reject zero/multiple
matches before MSBuild. Pass passwords only in the child environment, never
arguments or diagnostics. No certificate generation/import/export/trust changes.

Rejected: SignTool /a (implicit choice), excluding the public CA chain from every
PFX (changes operator export workflow), or selecting the first certificate
(ordering does not establish signing identity). The chain stays available for
validation; this fix only chooses the signer. Missing path/password, invalid
thumbprint, unreadable PFX and ambiguous leaves fail closed. Retrying repeats a
read-only selection; no stale key or certificate-store artifacts are created.

Checks: matching leaf selection/pinning, root exclusion, optional override,
missing/ambiguous matches, secret-safe errors, unsigned bypass, and packaging
argument forwarding. Real signed packaging remains unavailable until credentials
are supplied in the build process. This is a bounded local packaging fix; no
application auth, persistence, public contract or CA lifecycle redesign occurs.

Settled verification: all 14 signer tests pass, including real Windows PowerShell
filtering with synthetic public metadata. Standard and Windows mobile suites each
pass 56 suites / 403 tests; scoped ESLint and tracked diff whitespace checks pass.
The session has no configured PFX path/password, so actual PFX inspection and
signed MSIX generation remain unverified. The operator should retry the existing
`npm run package:windows` workflow in their configured terminal.

## Reported retry failure — consolidated diagnostic decision

FACT: the operator's retry fails inside selection, before MSBuild, but the generic
error discards whether PFX reading, manifest loading, or filtering failed. A fresh
in-memory Code Signing certificate exported to a temporary test PFX passes the
real Get-PfxData path; that temporary file was removed and no trust store changed.
UNKNOWN: the operator's PFX password, certificate contents, module environment,
and optional thumbprint setting are not available to this process.

Invariant: selection must remain unique, publisher-matched and non-CA; neither
automatic /a selection nor a manual bypass of certificate checks resolves this
unknown safely. Add structured stage codes and integer filter counts, with a
closed set of messages in Node. Never forward exception text, raw stderr, paths,
subjects, or passwords. Preserve successful output and the unsigned path.
Acceptance: success plus wrong-password, zero-match, stale-pin, multiple-match,
malformed diagnostics, timeout, and secret-leak rejection checks. The next real
operator retry must supply the safe failure category before a cause is claimed.

Verification of the diagnostic change: 23 focused tests pass. A temporary real
PFX with a leaf and CA chain (both containing private keys) selects the correct
leaf using Get-PfxData. A deliberately wrong fixture password produces the
PFX_READ_FAILED category. Fixture files were deleted; certificate stores were
untouched. The actual operator PFX failure is still unknown pending safe output.
