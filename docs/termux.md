# Termux and Android arm64

MindGit release builds include a standalone Android arm64 binary for 64-bit
Termux installations. The web UI is embedded in the executable, so no separate
HTML, JavaScript, or CSS files are required at runtime.

## Requirements

- A 64-bit Android device running Termux
- Git, which MindGit invokes for repository operations
- ripgrep (`rg`), which accelerates project search; MindGit has a slower Go
  fallback when it is unavailable

Install the runtime tools in Termux:

```bash
pkg update
pkg install git ripgrep
```

## Install a release binary

Download `mindgit-android-arm64` or `mindgit-android-arm64.tar.gz` from the
GitHub release. If the file was downloaded through the Android browser, make
shared storage available to Termux once:

```bash
termux-setup-storage
```

Android shared storage is normally mounted with `noexec`, so copy the binary
into Termux's private home directory before running it:

```bash
mkdir -p ~/bin
cp ~/storage/downloads/mindgit-android-arm64 ~/bin/mindgit
chmod +x ~/bin/mindgit
```

Confirm the installed release version:

```bash
mindgit -v
```

For the packaged artifact, extract it first:

```bash
tar -xzf ~/storage/downloads/mindgit-android-arm64.tar.gz -C ~/bin
mv ~/bin/mindgit-android-arm64 ~/bin/mindgit
chmod +x ~/bin/mindgit
```

Add `~/bin` to `PATH` if it is not already present:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Run MindGit

Start MindGit for a repository stored inside Termux:

```bash
mindgit --dir ~/projects/example --bind 127.0.0.1 --port 8787
```

Open this address in the Android browser:

```text
http://127.0.0.1:8787
```

Use `--bind 0.0.0.0` only when another device needs to connect over the local
network. That exposes MindGit to other hosts that can reach the phone, so use a
trusted network and stop the process when it is no longer needed.

## Verify the download

Each release includes `SHA256SUMS`. From the directory containing the downloaded
files, verify the binary with:

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

## Build on Linux for Termux

The release script builds all supported artifacts, including Android arm64:

```bash
scripts/build.sh
```

The relevant outputs are:

```text
dist/mindgit-android-arm64
dist/mindgit-android-arm64.tar.gz
```

To build only the Termux binary without release asset compression, run:

```bash
CGO_ENABLED=0 GOOS=android GOARCH=arm64 \
  go build -trimpath -ldflags="-s -w" \
  -o mindgit-android-arm64 .
```

The full release script additionally pre-compresses the embedded browser assets
and builds with the `compressedassets` tag. This keeps the application as one
executable while reducing the Android binary to roughly 8 MB.

## Build directly in Termux

Install Go and clone the repository:

```bash
pkg install golang git ripgrep
git clone https://github.com/Easul/mindgit.git
cd mindgit
go build -trimpath -ldflags="-s -w" -o ~/bin/mindgit .
```

A direct `go build` embeds the uncompressed development assets and is therefore
larger than the artifact produced by `scripts/build.sh`.

## Platform limitation

The Android build supports project browsing, diffs, editing, history, search,
PDF and structured-file viewing, and the other browser workbench features. The
integrated terminal currently uses Linux-specific PTY code and is not enabled
for the Android target.
