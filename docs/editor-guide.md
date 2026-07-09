# MindGit User Guide

This document covers the current built-in browser features and keyboard shortcuts in MindGit.

## Main workflow

- `Working Tree` shows the current Git worktree with changed files grouped by directory.
- `History` shows recent commits and lets you inspect commit diffs.
- Each opened file becomes a tab. Tabs remember:
  - selected mode (`Diff`, `Full`, `Edit`)
  - scroll position
  - editor cursor position
  - unsaved draft content
  - find/replace bar state
  - go-to-line bar state
- The file tab action menu supports `Diff`, `Full`, `Edit`, `Save`, `Copy Relative Path`, `Copy Absolute Path`, `Split Right`, `Split Down`, and `Close Tab`.
- The tree root and folder menus support creating files/folders and deleting paths.
- Split view can open a second file pane to the right or below the main pane.

## File modes

- `Diff` shows the file diff.
- `Full` shows the full file content.
- `Edit` opens the browser editor and allows saving back to disk.

## Search and review

- The header search uses `rg` to search across the project.
- Markdown and plain-text links can be opened with `Ctrl+Click` on Windows/Linux or `Cmd+Click` on macOS.
- The history view supports browsing commit lists, commit files, and restoring temporary staged files back out of the index.

## Editor behavior

- The editor shows line numbers and supports clicking a line number to move the cursor to that line.
- Pressing `Enter` inserts a newline with the current line indentation.
- Unsaved edits stay attached to the current tab until you save, close the tab, or reload the page.
- Word wrap is stored locally and restored on the next visit.

## Find and replace

- `Ctrl+F` opens the find/replace bar at the top-right of the editor.
- If text is selected when you press `Ctrl+F`, the selected text is used as the initial search string.
- The find bar supports:
  - plain-text search
  - regex search through the `.*` toggle
  - next/previous match navigation
  - single replace
  - replace all
- Regex mode supports:
  - capture-group replacements such as `$1`, `$2`, and `$<name>`
  - standard replacement escapes such as `\n`, `\r`, `\t`, and `\\`
  - line-aware anchors: `^` and `$` match line starts and ends
- The replace field keeps a fixed height and scrolls internally when the content is longer than the visible area.
- In the replace field:
  - `Enter` inserts a newline
  - `Ctrl+Enter` also inserts a newline
  - `Alt+Enter` runs single replace
- `Esc` closes the find bar.

## Go to line

- `Ctrl+G` opens the go-to-line bar centered at the top of the editor.
- Enter a positive line number to jump directly to that line.
- Negative numbers count from the end of the file:
  - `-1` jumps to the last line
  - `-10` jumps to the tenth line from the end
- After the jump, the cursor moves in the editor but focus stays in the go-to-line input so you can continue jumping.
- `Esc` closes the go-to-line bar.

## Keyboard shortcuts

### General editor

- `Ctrl+S`: save the current file
- `Ctrl+Z`: undo
- `Ctrl+Shift+Z`: redo
- `Ctrl+Y`: redo
- `Ctrl+F`: open find/replace
- `Ctrl+G`: open go-to-line
- `Alt+Z`: toggle word wrap
- `Esc`: close the visible command bar

### Line editing

- `Enter`: insert an indented newline
- `Ctrl+Enter`: insert a new line below the current line
- `Tab`: indent
- `Shift+Tab`: outdent by one tab, two spaces, or a single leading space
- `Alt+ArrowUp`: move the current line or selected lines up
- `Alt+ArrowDown`: move the current line or selected lines down
- `Ctrl+C` with no selection: copy the current line
- `Ctrl+X` with no selection: cut the current line

### Block selection and multi-cursor editing

- `Shift+Alt+Drag`: create a rectangular block selection with the mouse
- `Shift+Alt+ArrowLeft/Right/Up/Down`: create or extend a rectangular block selection from the keyboard
- `Ctrl+C` with a block selection: copy the block
- `Ctrl+X` with a block selection: cut the block
- Pasting into a multi-line block selection maps pasted lines to carets when the pasted line count matches the block line count.
- `Shift+Alt+Ctrl+ArrowUp`: duplicate the current line or selected block upward
- `Shift+Alt+Ctrl+ArrowDown`: duplicate the current line or selected block downward

### Advanced block-selection movement

- `Ctrl+ArrowLeft/ArrowRight` with a block selection: move each caret by word
- `Ctrl+ArrowUp/ArrowDown` with a block selection: move the block vertically
- `Ctrl+Shift+ArrowLeft/ArrowRight` with a block selection: extend each caret by word
- `Ctrl+Shift+ArrowUp/ArrowDown` with a block selection: extend or move the block vertically

## Notes and limits

- Shortcuts are currently implemented with the `Ctrl` modifier in the web app. They are not mirrored onto the `Cmd` key for editing actions.
- Structured editors such as Draw.io/KM reuse the same tab and draft workflow, but XMind is currently read-only.
