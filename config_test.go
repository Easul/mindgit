package main

import (
	"io"
	"os"
	"testing"
)

func TestParseConfigVersion(t *testing.T) {
	originalVersion := version
	version = "v1.2.3"
	t.Cleanup(func() { version = originalVersion })

	for _, args := range [][]string{{"-v"}, {"--version"}, {"version"}} {
		t.Run(args[0], func(t *testing.T) {
			var config Config
			var parseErr error
			output := captureStdout(t, func() {
				config, parseErr = parseConfig(args)
			})
			if parseErr != nil {
				t.Fatalf("parseConfig(%q): %v", args, parseErr)
			}
			if len(config.roots) != 0 {
				t.Fatalf("parseConfig(%q) roots = %q, want none", args, config.roots)
			}
			if output != "mindgit v1.2.3\n" {
				t.Fatalf("parseConfig(%q) output = %q", args, output)
			}
		})
	}
}

func captureStdout(t *testing.T, run func()) string {
	t.Helper()

	original := os.Stdout
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	os.Stdout = writer
	t.Cleanup(func() { os.Stdout = original })

	run()
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	os.Stdout = original
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	return string(output)
}
