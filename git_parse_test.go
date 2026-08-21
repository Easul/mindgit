package main

import (
	"reflect"
	"testing"
)

func TestParseStatus(t *testing.T) {
	stats := map[string][2]int{
		"main.go":    {3, 1},
		"renamed.go": {5, 2},
	}
	out := " M main.go\nA  added.go\n?? untracked.txt\n!! ignored.log\nR  old.go -> renamed.go\n"

	got := parseStatus(out, stats)
	want := []ChangedFile{
		{Path: "main.go", Status: "M", WorktreeStatus: "M", Unstaged: true, Additions: 3, Deletions: 1},
		{Path: "added.go", Status: "A", IndexStatus: "A", Staged: true},
		{Path: "untracked.txt", Status: "U", IndexStatus: "U", WorktreeStatus: "U", Staged: true, Unstaged: true},
		{Path: "ignored.log", Status: "I", IndexStatus: "I", WorktreeStatus: "I", Staged: true, Unstaged: true, Ignored: true},
		{Path: "renamed.go", Status: "M", IndexStatus: "M", Staged: true, Additions: 5, Deletions: 2},
	}

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseStatus() = %#v, want %#v", got, want)
	}
}

func TestParseStatusPreservesUnicodePaths(t *testing.T) {
	stats := map[string][2]int{
		"文档/新建.md": {2, 0},
	}

	got := parseStatus("?? 文档/新建.md\n", stats)
	if len(got) != 1 {
		t.Fatalf("parseStatus() returned %d files, want 1", len(got))
	}
	if got[0].Path != "文档/新建.md" {
		t.Fatalf("parseStatus() path = %q, want Unicode path", got[0].Path)
	}
	if got[0].Additions != 2 {
		t.Fatalf("parseStatus() additions = %d, want 2", got[0].Additions)
	}
}

func TestParseCommitOutput(t *testing.T) {
	commits := parseCommits("full1\x1fshort1\x1fAlice\x1falice@example.com\x1f2026-07-15T10:00:00Z\x1fFirst commit\x1efull2\x1fshort2\x1fBob\x1fbob@example.com\x1f2026-07-14T10:00:00Z\x1fSecond commit\x1e")
	if len(commits) != 2 {
		t.Fatalf("parseCommits() returned %d commits, want 2", len(commits))
	}
	if commits[0].Hash != "full1" || commits[0].Subject != "First commit" {
		t.Fatalf("unexpected first commit: %#v", commits[0])
	}

	files := parseNameStatus("M\tmain.go\nR100\told.go\trenamed.go\n")
	wantFiles := []ChangedFile{
		{Path: "main.go", Status: "M"},
		{Path: "renamed.go", Status: "M"},
	}
	if !reflect.DeepEqual(files, wantFiles) {
		t.Fatalf("parseNameStatus() = %#v, want %#v", files, wantFiles)
	}

	stats := parseNumstat("10\t2\tmain.go\n-\t-\timage.png\n3\t1\told.go\trenamed.go\n")
	wantStats := map[string][2]int{
		"main.go":    {10, 2},
		"image.png":  {0, 0},
		"renamed.go": {3, 1},
	}
	if !reflect.DeepEqual(stats, wantStats) {
		t.Fatalf("parseNumstat() = %#v, want %#v", stats, wantStats)
	}
}
