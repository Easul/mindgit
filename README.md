# MindGit

MindGit is a local code review workbench for checking AI-generated code changes before committing them.

It opens directly on uncommitted Git changes and combines a source-control style file list, diff viewer, single-file quick edit mode, and `rg` search in one browser UI.

## Features

- Shows uncommitted Git changes by default
- Groups changed files by directory with collapsible sections
- Displays per-file diffs with additions and deletions
- Supports quick single-file editing and save-back to disk
- Supports editor tabs with per-tab draft retention and UI state restore
- Supports split-pane review, history view, and per-file mode switching
- Includes built-in find/replace, go-to-line, and multi-cursor block editing
- Refreshes Git status and diff after saving
- Includes `rg`-powered search
- Supports dark and light themes with local persistence
- Supports configurable project directory, bind address, and port
- Includes a global, multi-tab xterm.js terminal panel with persistent server-side sessions on Linux

## User guide

For the current browser features, editor behavior, and built-in keyboard shortcuts, see:

- [docs/editor-guide.md](docs/editor-guide.md)
- [docs/termux.md](docs/termux.md) for Android arm64 installation and builds

## Install from source

Requirements:

- Go 1.26+
- Git
- ripgrep (`rg`) for search

Run from this repository:

```bash
go run .
```

Then open:

```text
http://127.0.0.1:8787
```

## Command line

```bash
mindgit [options]
mindgit help
mindgit version
```

Options:

```text
-d, --dir <path>      Project directory to inspect. Default: current directory
-b, --bind <addr>     Bind address: 127.0.0.1 or 0.0.0.0. Default: 127.0.0.1
-p, --port <port>     HTTP port. Default: 8787
-v, --version         Show version
-h, --help            Show help
```

Example:

```bash
mindgit --dir /path/to/project --bind 0.0.0.0 --port 8787
```

Print the embedded build version:

```bash
mindgit -v
```

## Build

Build stripped Linux, macOS, and Windows amd64 artifacts, plus an Android arm64
binary for Termux:

```bash
scripts/build.sh
```

Release builds embed pre-compressed web assets while remaining standalone
single-file executables. The Android artifact is `dist/mindgit-android-arm64`.

The Android binary targets 64-bit Termux installations. Copy it into Termux's
private storage rather than running it directly from shared storage:

```bash
pkg install git ripgrep
mkdir -p ~/bin
cp ~/storage/downloads/mindgit-android-arm64 ~/bin/mindgit
chmod +x ~/bin/mindgit
~/bin/mindgit --dir ~/projects/example
```

Then open `http://127.0.0.1:8787` in the Android browser. See the
[Termux guide](docs/termux.md) for source builds, network access, checksums, and
platform limitations.

## Release

Releases are created by pushing a tag that starts with `v`:

```bash
git tag v0.0.2
git push origin v0.0.2
```

The release workflow builds stripped Linux, macOS, and Windows amd64 artifacts
and an Android arm64 artifact for Termux, packages them, writes checksums, and
uploads the assets to a GitHub Release.

## Development checks

```bash
gofmt -w main.go
go test ./...
```
