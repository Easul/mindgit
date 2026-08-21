# AGENTS.md

## Project overview

MindGit is a small Go web application. `main.go` contains the HTTP API, Git command wrappers, CLI parsing, and embedded static assets. `web/index.html` contains the browser UI, CSS, and client-side JavaScript.

## Commands

- Format Go code: `gofmt -w main.go`
- Build and type-check: `go test ./...`
- Run locally: `go run . --dir /path/to/project --bind 127.0.0.1 --port 8787`
- Build stripped release artifacts: `scripts/build.sh`

## Conventions

- Keep the app dependency-light; prefer the Go standard library and plain HTML/CSS/JS.
- Preserve the single-binary model. Static files under `web/` are embedded with Go embed.
- Git commands that return repository paths must run with `-c core.quotePath=false` so
  non-ASCII filesystem names stay in the same UTF-8 form as `os.ReadDir` results and can be
  matched to file-tree entries.
- Do not commit generated files from `dist/`, local Playwright captures, or `temp/`.
- Keep CLI flags paired as short and long forms, for example `-p` and `--port`.
- Validate UI changes through the browser surface, not only by reading source.
- Keep the left change tree collapsed by default unless the user asks otherwise.
- Use `-trimpath -ldflags="-s -w"` for release binaries.

## Release workflow

GitHub releases are driven by `.github/workflows/release.yml` and tags matching `v*`.
