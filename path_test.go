package main

import "testing"

func TestCleanOptionalPath(t *testing.T) {
	app := App{}
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "empty", input: "", want: ""},
		{name: "relative", input: "web/../main.go", want: "main.go"},
		{name: "parent", input: "../outside", wantErr: true},
		{name: "absolute", input: "/tmp/outside", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := app.cleanOptionalPath(test.input)
			if (err != nil) != test.wantErr {
				t.Fatalf("cleanOptionalPath(%q) error = %v, wantErr %v", test.input, err, test.wantErr)
			}
			if got != test.want {
				t.Fatalf("cleanOptionalPath(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}
