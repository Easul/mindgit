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
```

Options:

```text
-d, --dir <path>      Project directory to inspect. Default: current directory
-b, --bind <addr>     Bind address: 127.0.0.1 or 0.0.0.0. Default: 127.0.0.1
-p, --port <port>     HTTP port. Default: 8787
-h, --help            Show help
```

Example:

```bash
mindgit --dir /path/to/project --bind 0.0.0.0 --port 8787
```

## Build

Build stripped Linux, macOS, and Windows amd64 artifacts:

```bash
scripts/build.sh
```

## Release

Releases are created by pushing a tag that starts with `v`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow builds stripped Linux, macOS, and Windows amd64 artifacts, packages them, writes checksums, and uploads the assets to a GitHub Release.

## Development checks

```bash
gofmt -w main.go
go test ./...
```
