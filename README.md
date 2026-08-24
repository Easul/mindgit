# MindGit

**English** | [简体中文](README.zh-CN.md)

MindGit is a lightweight, single-binary browser workbench for reviewing Git changes, editing project files, searching code, browsing history, and working with local or SSH-hosted projects.

It is designed for quickly checking AI-generated or manually written changes before committing them, without requiring a desktop Git client or a large server stack.

## Highlights

- Opens on the current Git working tree and groups changes by directory
- Shows per-file diffs, additions, deletions, staged, unstaged, and untracked states
- Supports full-file viewing and quick editing with draft retention
- Includes tabs, split panes, history browsing, find/replace, go-to-line, and multi-cursor block editing
- Searches with `rg` when available and falls back to Git-based search where possible
- Copies relative and absolute paths from project, file, and folder menus
- Supports multiple local projects and multiple named paths per SSH server
- Supports SSH jump hosts and ordered multi-hop `ProxyJump` chains
- Stores imported SSH private keys encrypted outside the main configuration file
- Provides a built-in multi-tab terminal on Linux
- Protects APIs and terminals with password authentication
- Shows MindGit CPU, memory, Goroutine, command, and terminal statistics
- Supports Chinese and English browser interfaces
- Uses the Go standard library and embedded static assets to preserve the single-binary model

## Platform requirements

Required:

- Go 1.26 or newer when building from source
- Git

Conditionally required:

- OpenSSH client command `ssh` when SSH connections are configured

Optional:

- ripgrep (`rg`) for faster project search

MindGit checks required commands at startup and exits with a clear error if a required command is missing. Missing optional commands are reported as warnings.

The integrated terminal is available in Linux builds. See [docs/termux.md](docs/termux.md) for Android/Termux notes.

## Quick start from source

Create the default configuration:

```bash
go run . --init-config --config ./config.json
```

Set the MindGit access password:

```bash
go run . --set-password --config ./config.json
```

Start MindGit:

```bash
go run . --config ./config.json
```

Open:

```text
http://127.0.0.1:8787
```

The default configuration and data directory names are:

```text
config.json
data/
```

When `--config` is omitted, MindGit looks for `config.json` beside the executable, not necessarily in the current working directory.

## Build

Build a local binary:

```bash
go build -trimpath -ldflags="-s -w" -o mindgit .
```

Run it:

```bash
./mindgit --config ./config.json
```

Build stripped Linux (amd64 and 32-bit ARMv7), macOS, Windows, and Android/Termux release artifacts:

```bash
scripts/build.sh
```

Release builds gzip embedded browser assets and preserve the single-binary deployment model. Generated artifacts are written to `dist/`.

## Command-line reference

```text
mindgit [options]
mindgit help
mindgit version
```

| Short | Long | Value | Description |
| --- | --- | --- | --- |
| `-d` | `--dir` | path | Add a local project directory. Repeat for multiple projects. |
| `-c` | `--config` | path | Use a JSON configuration file. Default: `config.json` beside the executable. |
| `-b` | `--bind` | address | Override the configured bind address. Default: `127.0.0.1`. |
| `-p` | `--port` | number | Override the configured HTTP port. Default: `8787`. |
| `-i` | `--init-config` | none | Create a new configuration file. Fails if the file already exists. |
| `-P` | `--set-password` | none | Set or replace the MindGit access password. |
| `-I` | `--import-ssh-key` | path | Import and encrypt an SSH private key. |
| `-n` | `--key-name` | name | Name used to store and reference an imported SSH key. |
| `-v` | `--version` | none | Print the embedded build version. |
| `-h` | `--help` | none | Show command-line help. |

Short and long forms are equivalent:

```bash
mindgit -c ./config.json -d /srv/project -b 127.0.0.1 -p 8787
mindgit --config ./config.json --dir /srv/project --bind 127.0.0.1 --port 8787
```

Add multiple command-line projects by repeating `--dir`:

```bash
mindgit \
  --config ./config.json \
  --dir /workspace/project-one \
  --dir /workspace/project-two
```

When at least one `--dir` is provided, command-line project directories replace the `projects` list from the configuration file for that run. `--bind` and `--port` also override their configured values.

Administrative commands perform their action and exit:

```bash
mindgit --init-config --config ./config.json
mindgit --set-password --config ./config.json
mindgit --import-ssh-key ~/.ssh/id_ed25519 --key-name production --config ./config.json
mindgit --version
```

## Configuration file

MindGit keeps server, authentication, monitoring, local project, and SSH connection metadata in one JSON file. Imported private keys are stored separately under `ssh.dataDir` and are never written into `config.json`.

Complete example:

```json
{
  "version": 1,
  "server": {
    "bind": "127.0.0.1",
    "port": 8787,
    "commandTimeoutSeconds": 120,
    "maxUploadMB": 64
  },
  "auth": {
    "enabled": true,
    "passwordHash": "generated by --set-password",
    "sessionHours": 12
  },
  "monitoring": {
    "enabled": true
  },
  "projects": [
    {
      "name": "mindgit",
      "path": "/workspace/mindgit"
    },
    {
      "name": "service-api",
      "path": "/workspace/service-api"
    }
  ],
  "ssh": {
    "dataDir": "data",
    "knownHosts": "data/known_hosts",
    "vaultSalt": "generated by --set-password",
    "connections": [
      {
        "name": "bastion",
        "host": "bastion.example.com",
        "port": 22,
        "user": "ops",
        "paths": [
          {
            "name": "tmp",
            "path": "/tmp"
          }
        ],
        "key": "bastion",
        "terminalOnly": true
      },
      {
        "name": "production",
        "host": "server.example.com",
        "port": 22,
        "user": "deploy",
        "paths": [
          {
            "name": "application",
            "path": "/srv/application"
          },
          {
            "name": "logs",
            "path": "/var/log/application"
          }
        ],
        "key": "production",
        "jumpHosts": ["bastion"],
        "forcePTY": false
      }
    ]
  }
}
```

Unknown configuration fields are rejected at startup to catch spelling mistakes.

### Server settings

| Field | Default | Description |
| --- | --- | --- |
| `bind` | `127.0.0.1` | Address used by the HTTP server. Use `0.0.0.0` or `::` only when remote access is required. |
| `port` | `8787` | HTTP listening port. |
| `commandTimeoutSeconds` | `120` | Timeout for non-interactive Git, search, local file helper, and SSH commands. Valid range: 1–3600. |
| `maxUploadMB` | `64` | Maximum upload and editor-save content size. Valid range: 1–10240. |

The command timeout does not terminate interactive terminal sessions. It protects browser API requests from commands or SSH servers that stop responding.

### Authentication settings

| Field | Description |
| --- | --- |
| `enabled` | Enables password authentication. New configurations enable it by default. |
| `passwordHash` | Generated by `--set-password`. Do not create or edit it manually. |
| `sessionHours` | Browser session lifetime in hours. Values less than or equal to zero fall back to 12 hours. |

Set the password interactively:

```bash
mindgit --set-password --config ./config.json
```

Changing the MindGit password is blocked while encrypted SSH keys exist because the password derives the SSH vault encryption key. Remove the encrypted key files, change the password, and import the keys again if a password rotation is required.

### Local projects

Each project entry contains:

```json
{
  "name": "service-api",
  "path": "/workspace/service-api"
}
```

Relative project paths are resolved relative to the configuration file. Duplicate resolved paths are ignored. Local project labels currently use `local / <directory-name>` in the browser.

If neither `projects` nor `--dir` supplies a project, MindGit uses the current working directory.

### Monitoring

```json
"monitoring": {
  "enabled": true
}
```

When enabled, the runtime dialog reports MindGit's own CPU usage, memory usage, Goroutines, executed commands, command latency, errors, and terminal count.

## SSH projects

Top-level SSH settings:

| Field | Default | Description |
| --- | --- | --- |
| `dataDir` | `data` | Directory containing encrypted keys, control sockets, and other SSH runtime data. |
| `knownHosts` | `<dataDir>/known_hosts` | Dedicated OpenSSH host-key database. |
| `vaultSalt` | generated | Generated by `--set-password` and used to derive the SSH vault key. Do not edit it manually. |
| `connections` | empty list | Configured SSH servers, jump hosts, and remote project paths. |

Relative `dataDir` and `knownHosts` paths are resolved relative to `config.json`.

An SSH connection may provide one or more named paths:

```json
{
  "name": "production",
  "host": "server.example.com",
  "port": 22,
  "user": "deploy",
  "paths": [
    {"name": "application", "path": "/srv/application"},
    {"name": "logs", "path": "/var/log/application"}
  ],
  "key": "production"
}
```

The browser project switcher displays these as:

```text
production / application
production / logs
```

### SSH connection fields

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Unique connection name. Also used by `jumpHosts` and project labels. |
| `host` | yes | DNS name, IPv4 address, or IPv6 address. |
| `port` | no | SSH port. Defaults to 22. |
| `user` | yes | Remote SSH user. |
| `paths` | yes | Named remote directories exposed as projects. Absolute remote paths are recommended. |
| `key` | no | Imported key name, not a filesystem path. |
| `jumpHosts` | no | Ordered list of other configured SSH connection names used with `ProxyJump`. |
| `terminalOnly` | no | When true, hides the connection's paths from the project switcher while keeping it available as a jump host or terminal target. |
| `forcePTY` | no | Compatibility mode for servers where non-PTY commands hang but `ssh -tt host command` works. |
| `remoteDir` | legacy | Older single-path field. It is converted to one `paths` entry at startup. Prefer `paths`. |

MindGit generates a private temporary OpenSSH configuration and does not depend on host aliases or options from `~/.ssh/config`. Configure the real `host`, `port`, `user`, imported `key`, and `jumpHosts` explicitly in `config.json`.

MindGit uses a dedicated `known_hosts` file, accepts previously unseen host keys on the first connection, and rejects changed host keys.

Normal SSH connections and jump hosts use OpenSSH connection reuse. A `forcePTY` target uses `RequestTTY force` and disables `ControlMaster` for that target because some PTY-only servers break reused non-interactive sessions.

## Importing SSH private keys

The `key` field in an SSH connection refers to an imported key name:

```json
"key": "production"
```

It does **not** refer directly to `~/.ssh/id_ed25519` or another source path.

### 1. Set the MindGit password first

```bash
mindgit --set-password --config ./config.json
```

This creates both `auth.passwordHash` and `ssh.vaultSalt`.

### 2. Import the private key

```bash
mindgit \
  --config ./config.json \
  --import-ssh-key ~/.ssh/id_ed25519 \
  --key-name production
```

Short form:

```bash
mindgit -c ./config.json -I ~/.ssh/id_ed25519 -n production
```

MindGit prompts for the MindGit access password, verifies it, encrypts the private key with AES-GCM, and writes:

```text
data/keys/production.key.enc
```

The original private key is not modified or deleted.

Valid key names contain only letters, numbers, `.`, `-`, and `_`, with a maximum length of 80 characters. The source file must look like a private key and must be no larger than 1 MB.

### Import multiple keys

```bash
mindgit -c ./config.json -I ~/.ssh/bastion_ed25519 -n bastion
mindgit -c ./config.json -I ~/.ssh/production_ed25519 -n production
```

Then reference them independently:

```json
{
  "name": "bastion",
  "key": "bastion"
}
```

```json
{
  "name": "production",
  "key": "production",
  "jumpHosts": ["bastion"]
}
```

### Non-interactive import

For controlled automation, MindGit can read the access password from `MINDGIT_PASSWORD`:

```bash
export MINDGIT_PASSWORD='your MindGit password'
mindgit -c ./config.json -I ~/.ssh/id_ed25519 -n production
unset MINDGIT_PASSWORD
```

Avoid storing the password in shell history, scripts, CI logs, or world-readable environment files.

### Passphrase-protected OpenSSH keys

MindGit encrypts the imported key file at rest regardless of whether the OpenSSH key itself has a passphrase. A passphrase-protected key can prompt inside an interactive SSH terminal, but background project operations cannot reliably answer an OpenSSH passphrase prompt. For full remote file and Git functionality, use an automation-appropriate key or an SSH setup that does not require an interactive passphrase prompt.

### Key storage and temporary files

- Encrypted keys are stored under `<ssh.dataDir>/keys/` with mode `0600`.
- The data and key directories are created with restrictive permissions.
- A decrypted temporary key is created only while an SSH command or terminal needs it.
- Temporary key files and generated SSH configuration files are removed afterward.
- The decryption key is derived from the authenticated MindGit password and kept only in authenticated server-session memory.

## Jump hosts

Configure each jump host as a normal SSH connection, then reference its connection name:

```json
{
  "name": "production",
  "host": "10.0.0.20",
  "port": 22,
  "user": "deploy",
  "paths": [{"name": "app", "path": "/srv/app"}],
  "key": "production",
  "jumpHosts": ["bastion"]
}
```

Multi-hop chains are ordered:

```json
"jumpHosts": ["edge", "bastion"]
```

Every referenced jump host must exist. Self-references, missing hosts, duplicate names, and jump cycles are rejected at startup.

## Browser usage

- Use the project switcher to move between local and SSH projects.
- Use the tree root, file, folder, and Changes menus for actions and path copying.
- Long project and action menus scroll when they do not fit in the viewport.
- Use `Ctrl+J` outside the terminal input to show or hide the terminal panel.
- Use `Ctrl+J` inside the terminal input to send a line feed instead of hiding the panel.
- Use the language action in the header to switch between Chinese and English.
- Use the runtime action to inspect MindGit's own resource usage.

For editor behavior and shortcuts, see [docs/editor-guide.md](docs/editor-guide.md).

## Security notes

- Keep `config.json` and `data/` readable only by the account running MindGit.
- Bind to `127.0.0.1` unless network access is intentionally required.
- When exposing MindGit beyond localhost, place it behind a trusted HTTPS reverse proxy.
- The MindGit password protects application access but does not encrypt plain HTTP traffic.
- Review the dedicated `known_hosts` file before accepting unexpected host-key changes.
- Use separate, least-privilege SSH keys and users where possible.
- Upload and editor-save sizes are bounded by `server.maxUploadMB`.
- Non-interactive commands are canceled when requests disconnect and are bounded by `server.commandTimeoutSeconds`.

## Version and release workflow

Print the embedded version:

```bash
mindgit --version
```

GitHub releases are driven by `.github/workflows/release.yml` and tags matching `v*`.

## Additional documentation

- [Editor and keyboard guide](docs/editor-guide.md)
- [Android/Termux guide](docs/termux.md)
