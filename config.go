package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	configFileVersion            = 1
	defaultCommandTimeoutSeconds = 120
	defaultMaxUploadMB           = 64
)

type Config struct {
	roots          []string
	host           string
	port           int
	configPath     string
	auth           AuthConfig
	ssh            SSHConfig
	monitoring     MonitoringConfig
	commandTimeout time.Duration
	maxUploadBytes int64
}

type FileConfig struct {
	Version    int              `json:"version"`
	Server     ServerConfig     `json:"server"`
	Auth       AuthConfig       `json:"auth"`
	Monitoring MonitoringConfig `json:"monitoring"`
	Projects   []ProjectConfig  `json:"projects"`
	SSH        SSHConfig        `json:"ssh"`
}

type ServerConfig struct {
	Bind                  string `json:"bind"`
	Port                  int    `json:"port"`
	CommandTimeoutSeconds int    `json:"commandTimeoutSeconds"`
	MaxUploadMB           int64  `json:"maxUploadMB"`
}

type AuthConfig struct {
	Enabled      bool   `json:"enabled"`
	PasswordHash string `json:"passwordHash,omitempty"`
	SessionHours int    `json:"sessionHours"`
}

type MonitoringConfig struct {
	Enabled bool `json:"enabled"`
}

type ProjectConfig struct {
	Name string `json:"name,omitempty"`
	Path string `json:"path"`
}

type SSHConfig struct {
	DataDir     string                `json:"dataDir,omitempty"`
	KnownHosts  string                `json:"knownHosts,omitempty"`
	VaultSalt   string                `json:"vaultSalt,omitempty"`
	Connections []SSHConnectionConfig `json:"connections"`
}

type SSHConnectionConfig struct {
	Name         string          `json:"name"`
	Host         string          `json:"host"`
	Port         int             `json:"port,omitempty"`
	User         string          `json:"user"`
	RemoteDir    string          `json:"remoteDir,omitempty"`
	Paths        []SSHPathConfig `json:"paths,omitempty"`
	Key          string          `json:"key,omitempty"`
	JumpHosts    []string        `json:"jumpHosts,omitempty"`
	ForcePTY     bool            `json:"forcePTY,omitempty"`
	TerminalOnly bool            `json:"terminalOnly,omitempty"`
}

type SSHPathConfig struct {
	Name string `json:"name"`
	Path string `json:"path"`
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

func defaultFileConfig() FileConfig {
	return FileConfig{
		Version: configFileVersion,
		Server: ServerConfig{
			Bind:                  "127.0.0.1",
			Port:                  8787,
			CommandTimeoutSeconds: defaultCommandTimeoutSeconds,
			MaxUploadMB:           defaultMaxUploadMB,
		},
		Auth:       AuthConfig{Enabled: true, SessionHours: 12},
		Monitoring: MonitoringConfig{Enabled: true},
		Projects:   []ProjectConfig{},
		SSH:        SSHConfig{Connections: []SSHConnectionConfig{}},
	}
}

func defaultConfigPath() string {
	executable, err := os.Executable()
	if err != nil {
		return "config.json"
	}
	resolved, err := filepath.EvalSymlinks(executable)
	if err == nil {
		executable = resolved
	}
	return filepath.Join(filepath.Dir(executable), "config.json")
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

	configPath := configPathFromArgs(args)
	fileConfig := defaultFileConfig()
	if _, err := os.Stat(configPath); err == nil {
		loaded, err := loadFileConfig(configPath)
		if err != nil {
			return Config{}, err
		}
		fileConfig = loaded
	} else if !os.IsNotExist(err) {
		return Config{}, err
	}

	config := Config{
		host:           fileConfig.Server.Bind,
		port:           fileConfig.Server.Port,
		configPath:     configPath,
		auth:           fileConfig.Auth,
		ssh:            fileConfig.SSH,
		monitoring:     fileConfig.Monitoring,
		commandTimeout: time.Duration(fileConfig.Server.CommandTimeoutSeconds) * time.Second,
		maxUploadBytes: fileConfig.Server.MaxUploadMB << 20,
	}
	config.ssh = resolveSSHPaths(config.configPath, config.ssh)
	flags := flag.NewFlagSet("mindgit", flag.ContinueOnError)
	flags.SetOutput(os.Stdout)
	flags.Usage = printUsage

	var help, showVersion, initConfig, setPassword bool
	var importSSHKey, keyName string
	var dirs multiStringFlag
	flags.BoolVar(&help, "h", false, "show help")
	flags.BoolVar(&help, "help", false, "show help")
	flags.BoolVar(&showVersion, "v", false, "show version")
	flags.BoolVar(&showVersion, "version", false, "show version")
	flags.Var(&dirs, "d", "project directory")
	flags.Var(&dirs, "dir", "project directory")
	flags.StringVar(&config.configPath, "c", config.configPath, "configuration file")
	flags.StringVar(&config.configPath, "config", config.configPath, "configuration file")
	flags.StringVar(&config.host, "b", config.host, "bind address")
	flags.StringVar(&config.host, "bind", config.host, "bind address")
	flags.IntVar(&config.port, "p", config.port, "server port")
	flags.IntVar(&config.port, "port", config.port, "server port")
	flags.BoolVar(&initConfig, "i", false, "initialize configuration")
	flags.BoolVar(&initConfig, "init-config", false, "initialize configuration")
	flags.BoolVar(&setPassword, "P", false, "set access password")
	flags.BoolVar(&setPassword, "set-password", false, "set access password")
	flags.StringVar(&importSSHKey, "I", "", "import and encrypt an SSH private key")
	flags.StringVar(&importSSHKey, "import-ssh-key", "", "import and encrypt an SSH private key")
	flags.StringVar(&keyName, "n", "", "SSH key name")
	flags.StringVar(&keyName, "key-name", "", "SSH key name")

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
	if initConfig {
		if err := initializeConfig(config.configPath); err != nil {
			return Config{}, err
		}
		fmt.Printf("created configuration: %s\n", config.configPath)
		return Config{}, nil
	}
	if setPassword {
		if err := updateConfigPassword(config.configPath); err != nil {
			return Config{}, err
		}
		fmt.Printf("updated access password: %s\n", config.configPath)
		return Config{}, nil
	}
	if importSSHKey != "" {
		if err := importEncryptedSSHKey(config.configPath, config.ssh, keyName, importSSHKey); err != nil {
			return Config{}, err
		}
		fmt.Printf("imported encrypted SSH key %q\n", keyName)
		return Config{}, nil
	}
	if config.port < 1 || config.port > 65535 {
		return Config{}, fmt.Errorf("port must be between 1 and 65535")
	}
	if strings.TrimSpace(config.host) == "" {
		return Config{}, fmt.Errorf("bind address cannot be empty")
	}
	if fileConfig.Server.CommandTimeoutSeconds < 1 || fileConfig.Server.CommandTimeoutSeconds > 3600 {
		return Config{}, fmt.Errorf("server commandTimeoutSeconds must be between 1 and 3600")
	}
	if fileConfig.Server.MaxUploadMB < 1 || fileConfig.Server.MaxUploadMB > 10240 {
		return Config{}, fmt.Errorf("server maxUploadMB must be between 1 and 10240")
	}

	if len(dirs) == 0 {
		for _, project := range fileConfig.Projects {
			dirs = append(dirs, project.Path)
		}
	}
	if len(dirs) == 0 {
		defaultRoot, err := os.Getwd()
		if err != nil {
			return Config{}, err
		}
		dirs = append(dirs, defaultRoot)
	}

	seen := map[string]bool{}
	config.roots = make([]string, 0, len(dirs))
	for _, dir := range dirs {
		root, err := resolveProjectPath(config.configPath, dir)
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
	if config.auth.SessionHours <= 0 {
		config.auth.SessionHours = 12
	}
	if config.auth.Enabled && config.auth.PasswordHash == "" {
		return Config{}, fmt.Errorf("access password is not configured; run mindgit --set-password --config %q", config.configPath)
	}
	return config, nil
}

func configPathFromArgs(args []string) string {
	path := defaultConfigPath()
	for index, arg := range args {
		if (arg == "-c" || arg == "--config") && index+1 < len(args) {
			return args[index+1]
		}
		if value, ok := strings.CutPrefix(arg, "--config="); ok {
			return value
		}
	}
	return path
}

func loadFileConfig(path string) (FileConfig, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return FileConfig{}, err
	}
	config := defaultFileConfig()
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&config); err != nil {
		return FileConfig{}, fmt.Errorf("read config %s: %w", path, err)
	}
	if config.Version != configFileVersion {
		return FileConfig{}, fmt.Errorf("unsupported config version %d", config.Version)
	}
	return config, nil
}

func initializeConfig(path string) error {
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("configuration already exists: %s", path)
	} else if !os.IsNotExist(err) {
		return err
	}
	root, err := os.Getwd()
	if err != nil {
		return err
	}
	config := defaultFileConfig()
	config.Projects = []ProjectConfig{{Name: filepath.Base(root), Path: root}}
	return writeFileConfig(path, config)
}

func writeFileConfig(path string, config FileConfig) error {
	content, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".mindgit-config-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(append(content, '\n')); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func resolveProjectPath(configPath, path string) (string, error) {
	if !filepath.IsAbs(path) {
		path = filepath.Join(filepath.Dir(configPath), path)
	}
	return filepath.Abs(path)
}

func resolveSSHPaths(configPath string, config SSHConfig) SSHConfig {
	base := filepath.Dir(configPath)
	if strings.TrimSpace(config.DataDir) == "" {
		config.DataDir = filepath.Join(base, "data")
	} else if !filepath.IsAbs(config.DataDir) {
		config.DataDir = filepath.Join(base, config.DataDir)
	}
	if strings.TrimSpace(config.KnownHosts) == "" {
		config.KnownHosts = filepath.Join(config.DataDir, "known_hosts")
	} else if !filepath.IsAbs(config.KnownHosts) {
		config.KnownHosts = filepath.Join(base, config.KnownHosts)
	}
	for index := range config.Connections {
		connection := &config.Connections[index]
		if len(connection.Paths) == 0 && strings.TrimSpace(connection.RemoteDir) != "" {
			connection.Paths = []SSHPathConfig{{Name: filepath.Base(connection.RemoteDir), Path: connection.RemoteDir}}
		}
	}
	return config
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
  -d, --dir <path>      Project directory. Repeat for multiple projects
  -c, --config <path>   JSON configuration file. Default: beside the executable
  -b, --bind <addr>     Bind address. Default: 127.0.0.1
  -p, --port <port>     HTTP port. Default: 8787
  -i, --init-config     Create a configuration file
  -P, --set-password   Set or replace the access password
  -I, --import-ssh-key Import and encrypt an SSH private key
  -n, --key-name       Name used by SSH connection key fields
  -v, --version         Show version
  -h, --help            Show this help

Command-line project, bind, and port options override the configuration file.`)
}
