package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxSSHPrivateKeySize = 1024 * 1024

type encryptedSSHKey struct {
	Version    int    `json:"version"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

func importEncryptedSSHKey(configPath string, sshConfig SSHConfig, name, source string) error {
	if !validSSHKeyName(name) {
		return fmt.Errorf("SSH key name must contain only letters, numbers, dot, dash, or underscore")
	}
	fileConfig, err := loadFileConfig(configPath)
	if err != nil {
		return err
	}
	if !fileConfig.Auth.Enabled || fileConfig.Auth.PasswordHash == "" || fileConfig.SSH.VaultSalt == "" {
		return fmt.Errorf("set the MindGit access password before importing SSH keys")
	}
	password := os.Getenv("MINDGIT_PASSWORD")
	if password == "" {
		password, err = readSecret("MindGit password: ")
		if err != nil {
			return err
		}
	}
	if !verifyPassword(password, fileConfig.Auth.PasswordHash) {
		return fmt.Errorf("invalid MindGit password")
	}
	content, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if len(content) == 0 || len(content) > maxSSHPrivateKeySize {
		return fmt.Errorf("SSH private key must be between 1 byte and 1 MB")
	}
	if strings.Contains(string(content), " PUBLIC KEY") || !strings.Contains(string(content), "PRIVATE KEY") {
		return fmt.Errorf("file does not look like an SSH private key")
	}
	salt, err := base64.RawStdEncoding.DecodeString(fileConfig.SSH.VaultSalt)
	if err != nil || len(salt) < 16 {
		return fmt.Errorf("invalid SSH vault salt")
	}
	vaultKey := pbkdf2SHA256([]byte(password), salt, passwordIterations, 32)
	sshConfig = resolveSSHPaths(configPath, sshConfig)
	return writeEncryptedSSHKey(sshConfig, name, content, vaultKey)
}

func writeEncryptedSSHKey(config SSHConfig, name string, plaintext, vaultKey []byte) error {
	block, err := aes.NewCipher(vaultKey)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	sealed := gcm.Seal(nil, nonce, plaintext, []byte(name))
	encoded, err := json.Marshal(encryptedSSHKey{
		Version:    1,
		Nonce:      base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		return err
	}
	keyDir := filepath.Join(config.DataDir, "keys")
	if err := os.MkdirAll(keyDir, 0o700); err != nil {
		return err
	}
	return writePrivateFile(filepath.Join(keyDir, name+".key.enc"), append(encoded, '\n'))
}

func readEncryptedSSHKey(config SSHConfig, name string, vaultKey []byte) ([]byte, error) {
	if !validSSHKeyName(name) || len(vaultKey) != 32 {
		return nil, errors.New("SSH key vault is locked")
	}
	content, err := os.ReadFile(filepath.Join(config.DataDir, "keys", name+".key.enc"))
	if err != nil {
		return nil, err
	}
	var encrypted encryptedSSHKey
	if err := json.Unmarshal(content, &encrypted); err != nil || encrypted.Version != 1 {
		return nil, fmt.Errorf("invalid encrypted SSH key %q", name)
	}
	nonce, err := base64.RawStdEncoding.DecodeString(encrypted.Nonce)
	if err != nil {
		return nil, fmt.Errorf("invalid encrypted SSH key %q", name)
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(encrypted.Ciphertext)
	if err != nil {
		return nil, fmt.Errorf("invalid encrypted SSH key %q", name)
	}
	block, err := aes.NewCipher(vaultKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, []byte(name))
	if err != nil {
		return nil, fmt.Errorf("cannot decrypt SSH key %q", name)
	}
	return plaintext, nil
}

func writePrivateFile(path string, content []byte) error {
	directory := filepath.Dir(path)
	temporary, err := os.CreateTemp(directory, ".mindgit-private-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func validSSHKeyName(name string) bool {
	if name == "" || len(name) > 80 {
		return false
	}
	for _, character := range name {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') || character == '.' || character == '-' || character == '_' {
			continue
		}
		return false
	}
	return true
}
