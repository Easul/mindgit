package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	roots []string
	host  string
	port  int
}

var version = "dev"

type multiStringFlag []string

func (m *multiStringFlag) String() string {
	return strings.Join(*m, ", ")
}

func (m *multiStringFlag) Set(value string) error {
	*m = append(*m, value)
	return nil
}

func parseConfig(args []string) (Config, error) {
	if len(args) == 1 && args[0] == "help" {
		printUsage()
		return Config{}, nil
	}
	if len(args) == 1 && args[0] == "version" {
		printVersion()
		return Config{}, nil
	}

	config := Config{host: "127.0.0.1", port: 8787}
	flags := flag.NewFlagSet("mindgit", flag.ContinueOnError)
	flags.SetOutput(os.Stdout)
	flags.Usage = printUsage

	var help, showVersion bool
	var dirs multiStringFlag
	flags.BoolVar(&help, "h", false, "show help")
	flags.BoolVar(&help, "help", false, "show help")
	flags.BoolVar(&showVersion, "v", false, "show version")
	flags.BoolVar(&showVersion, "version", false, "show version")
	flags.Var(&dirs, "d", "project directory")
	flags.Var(&dirs, "dir", "project directory")
	flags.StringVar(&config.host, "b", config.host, "bind address, for example 127.0.0.1 or 0.0.0.0")
	flags.StringVar(&config.host, "bind", config.host, "bind address, for example 127.0.0.1 or 0.0.0.0")
	flags.IntVar(&config.port, "p", config.port, "server port")
	flags.IntVar(&config.port, "port", config.port, "server port")

	if err := flags.Parse(args); err != nil {
		return Config{}, err
	}
	if help {
		printUsage()
		return Config{}, nil
	}
	if showVersion {
		printVersion()
		return Config{}, nil
	}
	if flags.NArg() > 0 {
		return Config{}, fmt.Errorf("unexpected argument: %s", flags.Arg(0))
	}
	if config.port < 1 || config.port > 65535 {
		return Config{}, fmt.Errorf("port must be between 1 and 65535")
	}

	defaultRoot, err := os.Getwd()
	if err != nil {
		return Config{}, err
	}

	if len(dirs) == 0 {
		dirs = append(dirs, defaultRoot)
	}

	seen := map[string]bool{}
	config.roots = make([]string, 0, len(dirs))
	for _, dir := range dirs {
		root, err := filepath.Abs(dir)
		if err != nil {
			return Config{}, err
		}
		info, err := os.Stat(root)
		if err != nil {
			return Config{}, err
		}
		if !info.IsDir() {
			return Config{}, fmt.Errorf("project directory is not a directory: %s", root)
		}
		if seen[root] {
			continue
		}
		seen[root] = true
		config.roots = append(config.roots, root)
	}
	return config, nil
}

func printVersion() {
	fmt.Printf("mindgit %s\n", version)
}

func printUsage() {
	fmt.Println(`MindGit - local code review workbench

Usage:
  mindgit [options]
  mindgit help
  mindgit version

Options:
  -d, --dir <path>      Project directory to inspect. Repeat to open multiple projects. Default: current directory
  -b, --bind <addr>     Bind address: 127.0.0.1 or 0.0.0.0. Default: 127.0.0.1
  -p, --port <port>     HTTP port. Default: 8787
  -v, --version         Show version
  -h, --help            Show this help`)
}
