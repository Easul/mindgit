# MindGit

[English](README.md) | **简体中文**

MindGit 是一个轻量、单二进制的浏览器项目工作台，用于查看 Git 改动、编辑文件、搜索代码、浏览历史，以及操作本地或 SSH 服务器上的项目。

它适合在提交代码之前快速检查 AI 生成或人工编写的改动，不需要安装大型桌面 Git 客户端或复杂的服务端依赖。

## 主要功能

- 默认展示当前 Git 工作区改动，并按目录分组
- 展示文件 Diff、增删行数、暂存、未暂存和未跟踪状态
- 支持完整文件查看、快速编辑和未保存草稿保留
- 支持标签页、分屏、历史记录、查找替换、跳转行和多光标块编辑
- 优先使用 `rg` 搜索，并在可用场景下回退到 Git 搜索
- 可从项目、文件和文件夹菜单复制相对路径或绝对路径
- 支持多个本地项目，以及每台 SSH 服务器配置多个命名路径
- 支持 SSH 跳板机和有序多级 `ProxyJump`
- 导入的 SSH 私钥加密保存在主配置文件之外
- Linux 下提供内置多标签终端
- 使用访问密码保护 API 和终端
- 展示 MindGit 自身 CPU、内存、Goroutine、命令和终端统计
- 浏览器界面支持中英文切换
- 仅依赖 Go 标准库并嵌入静态资源，保持单二进制部署

## 环境要求

必需命令：

- 从源码构建时需要 Go 1.26 或更高版本
- Git

按配置需要：

- 配置 SSH 连接时需要 OpenSSH 客户端命令 `ssh`

可选命令：

- ripgrep（`rg`），用于更快的项目搜索

MindGit 启动时会检查强依赖命令。缺少强依赖时会明确提示并退出；缺少可选命令时只输出警告。

内置终端目前用于 Linux 构建。Android/Termux 说明请查看 [docs/termux.md](docs/termux.md)。

## 从源码快速开始

创建默认配置：

```bash
go run . --init-config --config ./config.json
```

设置 MindGit 访问密码：

```bash
go run . --set-password --config ./config.json
```

启动 MindGit：

```bash
go run . --config ./config.json
```

浏览器打开：

```text
http://127.0.0.1:8787
```

默认配置文件和数据目录名称为：

```text
config.json
data/
```

没有指定 `--config` 时，MindGit 会在二进制文件所在目录查找 `config.json`，不一定是当前命令行目录。

## 构建

构建当前平台二进制：

```bash
go build -trimpath -ldflags="-s -w" -o mindgit .
```

启动：

```bash
./mindgit --config ./config.json
```

构建 Linux（amd64 和 32 位 ARMv7）、macOS、Windows 和 Android/Termux 发布包：

```bash
scripts/build.sh
```

发布构建会对嵌入的浏览器资源进行 gzip 压缩，同时继续保持单二进制部署。生成文件位于 `dist/`。

## 命令行参数

```text
mindgit [options]
mindgit help
mindgit version
```

| 短参数 | 长参数 | 参数值 | 说明 |
| --- | --- | --- | --- |
| `-d` | `--dir` | 路径 | 添加一个本地项目目录，可重复指定多个项目。 |
| `-c` | `--config` | 路径 | 指定 JSON 配置文件。默认使用二进制旁的 `config.json`。 |
| `-b` | `--bind` | 地址 | 覆盖配置中的监听地址，默认 `127.0.0.1`。 |
| `-p` | `--port` | 端口 | 覆盖配置中的 HTTP 端口，默认 `8787`。 |
| `-i` | `--init-config` | 无 | 创建新配置文件；文件已经存在时失败。 |
| `-P` | `--set-password` | 无 | 设置或更换 MindGit 访问密码。 |
| `-I` | `--import-ssh-key` | 路径 | 导入并加密 SSH 私钥。 |
| `-n` | `--key-name` | 名称 | 导入 SSH 私钥时用于保存和引用的名称。 |
| `-v` | `--version` | 无 | 输出当前构建版本。 |
| `-h` | `--help` | 无 | 显示帮助。 |

短参数和长参数效果一致：

```bash
mindgit -c ./config.json -d /srv/project -b 127.0.0.1 -p 8787
mindgit --config ./config.json --dir /srv/project --bind 127.0.0.1 --port 8787
```

重复使用 `--dir` 可指定多个本地项目：

```bash
mindgit \
  --config ./config.json \
  --dir /workspace/project-one \
  --dir /workspace/project-two
```

只要命令行中指定了一个或多个 `--dir`，本次运行就会使用这些目录替代配置文件里的 `projects`。`--bind` 和 `--port` 同样会覆盖配置值。

下面这些管理命令执行完成后会直接退出：

```bash
mindgit --init-config --config ./config.json
mindgit --set-password --config ./config.json
mindgit --import-ssh-key ~/.ssh/id_ed25519 --key-name production --config ./config.json
mindgit --version
```

## 配置文件

MindGit 使用一个 JSON 文件保存服务、认证、监控、本地项目和 SSH 连接信息。导入的私钥单独保存在 `ssh.dataDir` 下，不会写入 `config.json`。

完整示例：

```json
{
  "version": 1,
  "server": {
    "bind": "127.0.0.1",
    "port": 8787,
    "commandTimeoutSeconds": 120,
    "maxUploadMB": 64
  },
  "auth": {
    "enabled": true,
    "passwordHash": "由 --set-password 生成",
    "sessionHours": 12
  },
  "monitoring": {
    "enabled": true
  },
  "projects": [
    {
      "name": "mindgit",
      "path": "/workspace/mindgit"
    },
    {
      "name": "service-api",
      "path": "/workspace/service-api"
    }
  ],
  "ssh": {
    "dataDir": "data",
    "knownHosts": "data/known_hosts",
    "vaultSalt": "由 --set-password 生成",
    "connections": [
      {
        "name": "bastion",
        "host": "bastion.example.com",
        "port": 22,
        "user": "ops",
        "paths": [
          {
            "name": "tmp",
            "path": "/tmp"
          }
        ],
        "key": "bastion",
        "terminalOnly": true
      },
      {
        "name": "production",
        "host": "server.example.com",
        "port": 22,
        "user": "deploy",
        "paths": [
          {
            "name": "application",
            "path": "/srv/application"
          },
          {
            "name": "logs",
            "path": "/var/log/application"
          }
        ],
        "key": "production",
        "jumpHosts": ["bastion"],
        "forcePTY": false
      }
    ]
  }
}
```

MindGit 会拒绝未知配置字段，以便尽早发现字段拼写错误。

### 服务配置

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `bind` | `127.0.0.1` | HTTP 服务监听地址。只有确实需要远程访问时才使用 `0.0.0.0` 或 `::`。 |
| `port` | `8787` | HTTP 服务端口。 |
| `commandTimeoutSeconds` | `120` | 非交互 Git、搜索、本地文件辅助命令和 SSH 命令的超时时间，范围 1–3600。 |
| `maxUploadMB` | `64` | 上传和编辑器保存内容的最大体积，范围 1–10240。 |

命令超时不影响交互式终端，它主要避免浏览器请求断开或 SSH 服务器无响应后命令永久运行。

### 认证配置

| 字段 | 说明 |
| --- | --- |
| `enabled` | 是否启用密码认证。新配置默认启用。 |
| `passwordHash` | 由 `--set-password` 生成，请勿手工填写或修改。 |
| `sessionHours` | 浏览器会话有效时间。小于等于 0 时回退到 12 小时。 |

交互式设置密码：

```bash
mindgit --set-password --config ./config.json
```

存在加密 SSH 私钥时不允许直接更换 MindGit 密码，因为 SSH 私钥保险库的加密密钥由该密码派生。如果需要更换密码，请先移除加密私钥文件，修改密码后再重新导入。

### 本地项目

每个项目配置格式：

```json
{
  "name": "service-api",
  "path": "/workspace/service-api"
}
```

相对路径基于配置文件所在目录解析。解析后重复的路径会被忽略。当前浏览器中的本地项目名称显示为 `local / <目录名>`。

如果 `projects` 和命令行 `--dir` 都没有提供项目，MindGit 使用当前工作目录。

### 运行监控

```json
"monitoring": {
  "enabled": true
}
```

启用后，运行状态弹窗会显示 MindGit 自身 CPU、内存、Goroutine、命令数量、命令耗时、错误数和终端数量。

## SSH 项目

SSH 顶层配置：

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `dataDir` | `data` | 保存加密私钥、连接复用 Socket 和其他 SSH 运行数据的目录。 |
| `knownHosts` | `<dataDir>/known_hosts` | MindGit 独立使用的 OpenSSH 主机密钥数据库。 |
| `vaultSalt` | 自动生成 | 由 `--set-password` 生成，用于派生 SSH 私钥保险库密钥，请勿手工修改。 |
| `connections` | 空列表 | 配置的 SSH 服务器、跳板机和远程项目路径。 |

相对的 `dataDir` 和 `knownHosts` 路径基于 `config.json` 所在目录解析。

每个 SSH 连接可以提供多个命名路径：

```json
{
  "name": "production",
  "host": "server.example.com",
  "port": 22,
  "user": "deploy",
  "paths": [
    {"name": "application", "path": "/srv/application"},
    {"name": "logs", "path": "/var/log/application"}
  ],
  "key": "production"
}
```

项目切换列表中显示为：

```text
production / application
production / logs
```

### SSH 连接字段

| 字段 | 是否必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 唯一连接名称，同时用于 `jumpHosts` 引用和项目名称。 |
| `host` | 是 | 域名、IPv4 地址或 IPv6 地址。 |
| `port` | 否 | SSH 端口，默认 22。 |
| `user` | 是 | SSH 用户名。 |
| `paths` | 是 | 作为项目展示的远程命名目录列表，建议使用绝对路径。 |
| `key` | 否 | 已导入的私钥名称，不是文件路径。 |
| `jumpHosts` | 否 | 按顺序填写其他 SSH 连接的名称，通过 `ProxyJump` 使用。 |
| `terminalOnly` | 否 | 为 `true` 时不在项目列表展示，但仍可作为跳板机或终端连接。 |
| `forcePTY` | 否 | 用于普通非 PTY 命令卡住、但 `ssh -tt host command` 正常的服务器。 |
| `remoteDir` | 兼容字段 | 旧版单路径字段，启动时会转换为一个 `paths` 项。新配置应使用 `paths`。 |

MindGit 会生成独立的临时 OpenSSH 配置，不依赖 `~/.ssh/config` 中的主机别名或连接参数。因此需要在 `config.json` 中明确填写真实 `host`、`port`、`user`、导入后的 `key` 和 `jumpHosts`。

MindGit 使用独立的 `known_hosts` 文件。第一次连接会接受新主机密钥，之后如果主机密钥发生变化会拒绝连接。

普通 SSH 连接和跳板机会使用 OpenSSH 连接复用。`forcePTY` 目标会使用 `RequestTTY force`，并关闭该目标的 `ControlMaster`，因为部分只能使用 PTY 的服务器会破坏复用的非交互会话。

## 导入 SSH 私钥

SSH 连接中的 `key` 字段填写的是导入后的名称：

```json
"key": "production"
```

它**不是** `~/.ssh/id_ed25519` 等私钥源文件路径。

### 第一步：先设置 MindGit 密码

```bash
mindgit --set-password --config ./config.json
```

这一步会生成 `auth.passwordHash` 和 `ssh.vaultSalt`。

### 第二步：导入私钥

```bash
mindgit \
  --config ./config.json \
  --import-ssh-key ~/.ssh/id_ed25519 \
  --key-name production
```

短参数写法：

```bash
mindgit -c ./config.json -I ~/.ssh/id_ed25519 -n production
```

MindGit 会提示输入 MindGit 访问密码，验证成功后使用 AES-GCM 加密私钥，并写入：

```text
data/keys/production.key.enc
```

原始私钥文件不会被修改或删除。

私钥名称只允许字母、数字、`.`、`-` 和 `_`，最长 80 个字符。源文件必须看起来是私钥，且大小不能超过 1 MB。

### 导入多个私钥

```bash
mindgit -c ./config.json -I ~/.ssh/bastion_ed25519 -n bastion
mindgit -c ./config.json -I ~/.ssh/production_ed25519 -n production
```

然后分别引用：

```json
{
  "name": "bastion",
  "key": "bastion"
}
```

```json
{
  "name": "production",
  "key": "production",
  "jumpHosts": ["bastion"]
}
```

### 非交互式导入

在受控自动化环境中，可以通过 `MINDGIT_PASSWORD` 提供访问密码：

```bash
export MINDGIT_PASSWORD='你的 MindGit 密码'
mindgit -c ./config.json -I ~/.ssh/id_ed25519 -n production
unset MINDGIT_PASSWORD
```

不要把密码写入 Shell 历史、脚本、CI 日志或其他用户可读的环境文件。

### 自带 OpenSSH 口令的私钥

无论 OpenSSH 私钥本身是否带有口令，MindGit 都会再次对导入文件进行加密保存。带口令私钥可以在交互式 SSH 终端中提示输入，但后台项目文件和 Git 操作无法可靠回答 OpenSSH 的口令提示。若需要完整远程项目功能，请使用适合自动化操作的私钥，或使用不需要交互输入口令的 SSH 方案。

### 私钥存储和临时文件

- 加密私钥保存在 `<ssh.dataDir>/keys/` 下，文件权限为 `0600`。
- 数据目录和私钥目录使用严格权限创建。
- 只有执行 SSH 命令或打开终端时才创建解密后的临时私钥。
- SSH 操作结束后会移除临时私钥和生成的 SSH 配置。
- 解密密钥由已认证的 MindGit 密码派生，只保存在认证会话内存中。

## 跳板机

先把跳板机配置为普通 SSH 连接，然后通过连接名称引用：

```json
{
  "name": "production",
  "host": "10.0.0.20",
  "port": 22,
  "user": "deploy",
  "paths": [{"name": "app", "path": "/srv/app"}],
  "key": "production",
  "jumpHosts": ["bastion"]
}
```

多级跳板按顺序填写：

```json
"jumpHosts": ["edge", "bastion"]
```

所有跳板机名称都必须存在。重复名称、引用自身、缺少跳板机和循环引用会在启动时被拒绝。

## 浏览器使用

- 使用项目切换按钮切换本地和 SSH 项目。
- 使用项目根目录、文件、文件夹和 Changes 菜单执行操作或复制路径。
- 项目或操作菜单过长、屏幕放不下时会自动出现滚动条。
- 光标不在终端输入框时，`Ctrl+J` 显示或隐藏终端。
- 光标位于终端输入框时，`Ctrl+J` 会发送换行，不会关闭终端。
- 使用顶部语言按钮切换中文和英文。
- 使用运行状态按钮查看 MindGit 自身资源占用。

编辑器功能和快捷键请查看 [docs/editor-guide.md](docs/editor-guide.md)。

## 安全建议

- 确保 `config.json` 和 `data/` 只有运行 MindGit 的系统账户可以读取。
- 除非确实需要远程访问，否则监听地址保持为 `127.0.0.1`。
- 对外提供访问时，请放在可信 HTTPS 反向代理后面。
- MindGit 密码只保护应用访问，不会加密明文 HTTP 流量。
- 如果主机密钥意外变化，请先检查独立的 `known_hosts` 文件，不要直接忽略警告。
- 尽量为 MindGit 使用独立、低权限的 SSH 用户和私钥。
- 上传和编辑器保存大小由 `server.maxUploadMB` 限制。
- 非交互命令会在浏览器请求断开时取消，并受 `server.commandTimeoutSeconds` 限制。

## 版本和发布

查看构建版本：

```bash
mindgit --version
```

GitHub Release 由 `.github/workflows/release.yml` 驱动，版本标签匹配 `v*`。

## 更多文档

- [编辑器与快捷键说明](docs/editor-guide.md)
- [Android/Termux 说明](docs/termux.md)
