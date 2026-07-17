package main

import (
	"fmt"
	"strconv"
	"strings"
)

func sshArguments(config SSHConfig, connection SSHConnectionConfig) ([]string, error) {
	connections := make(map[string]SSHConnectionConfig, len(config.Connections))
	for _, candidate := range config.Connections {
		connections[candidate.Name] = candidate
	}
	arguments := []string{"-o", "BatchMode=yes"}
	if config.KnownHosts != "" {
		arguments = append(arguments, "-o", "UserKnownHostsFile="+config.KnownHosts)
	}
	if connection.Port > 0 {
		arguments = append(arguments, "-p", strconv.Itoa(connection.Port))
	}
	if len(connection.JumpHosts) > 0 {
		jumpTargets := make([]string, 0, len(connection.JumpHosts))
		for _, name := range connection.JumpHosts {
			jump, ok := connections[name]
			if !ok {
				return nil, fmt.Errorf("unknown jump host: %s", name)
			}
			target := jump.User + "@" + jump.Host
			if jump.Port > 0 && jump.Port != 22 {
				target += ":" + strconv.Itoa(jump.Port)
			}
			jumpTargets = append(jumpTargets, target)
		}
		arguments = append(arguments, "-J", strings.Join(jumpTargets, ","))
	}
	arguments = append(arguments, connection.User+"@"+connection.Host)
	return arguments, nil
}
