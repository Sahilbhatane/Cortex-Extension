# Cortex AI for VS Code

A VS Code extension for [Cortex](https://github.com/cortexlinux/cortex), the AI-powered package manager for Linux.

## What is Cortex?

Cortex is a command-line tool that translates natural language into Linux package installation commands. Instead of memorizing package names, you describe what you need:

```
cortex install "something to edit PDFs"
cortex install "web server for static sites"
```

Cortex uses AI (Claude, OpenAI, or local Ollama) to interpret your request and generate safe, validated `apt` commands.

## Features

- **Automatic CLI Installation**: Cortex CLI is automatically installed when you first use the extension (via pip)
- **Command Palette Integration**: `Cortex: Run Command` (Ctrl+Shift+C / Cmd+Shift+C)
- **Side Panel**: Copilot-like chat interface for natural language queries
- **Status Bar Indicator**: Shows connection status and configured provider
- **Secure API Key Storage**: API keys stored securely using VS Code's Secret Storage
- **Multiple LLM Providers**: Support for Anthropic Claude, OpenAI GPT-4, and local Ollama
- **Integrated Terminal**: Commands execute in VS Code's integrated terminal
- **WSL Support**: Works on Windows via WSL

## Supported Platforms

- **Linux** (Ubuntu 22.04+, Debian 12+)
- **Windows** via WSL (Windows Subsystem for Linux)
- **Remote SSH** to Linux servers
- **Dev Containers** (Linux-based)

macOS and native Windows are not supported (Cortex requires apt/Linux).

## Prerequisites

- **Python & pip**: Required for automatic Cortex CLI installation
  
  ```bash
  # Ubuntu/Debian
  sudo apt install python3 python3-pip
  ```

> **Note**: The Cortex CLI (`cortex-apt-cli`) is automatically installed via pip when you first use the extension. No manual installation is required!

## Getting Started

1. **Install the extension** from the VS Code Marketplace

2. **The extension will prompt you to install Cortex CLI** if not already installed
   - Click "Install Cortex CLI" when prompted
   - The installation runs via `pip install cortex-apt-cli`

3. **Configure your API provider**:
   - Open Command Palette → `Cortex: Set API Key`
   - Choose your provider (Anthropic, OpenAI, or Ollama)
   - Enter your API key (not required for Ollama)

4. **Start using Cortex**:
   - Press `Ctrl+Shift+C` (Windows/Linux) or `Cmd+Shift+C` (macOS)
   - Or open the Cortex panel from the Activity Bar

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `Cortex: Run Command` | Ctrl+Shift+C | Quick input for natural language queries |
| `Cortex: Open Panel` | - | Open the Cortex side panel |
| `Cortex: Set API Key` | - | Configure API key for your LLM provider |
| `Cortex: Clear API Key` | - | Remove stored API keys |
| `Cortex: Check Connection Status` | - | View current configuration and status |
| `Cortex: Install CLI` | - | Manually install/reinstall Cortex CLI |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `cortex.llmProvider` | `anthropic` | LLM provider (anthropic, openai, ollama) |
| `cortex.ollamaEndpoint` | `http://localhost:11434` | Ollama API endpoint |

## Usage Examples

In the Cortex panel or command input:

- `nginx with SSL support` → Runs `cortex install "nginx with SSL support" --dry-run`
- `docker and docker-compose` → Runs `cortex install "docker and docker-compose" --dry-run`
- `cortex history` → Shows installation history
- `cortex rollback <id>` → Undoes an installation

To actually execute (not just preview):
- `cortex install nginx --execute`

## Known Limitations

- **Linux only**: Cortex wraps `apt` and is designed for Debian-based systems
- **Python/pip required**: Automatic CLI installation requires Python and pip
- **API key required**: Without a configured LLM provider (or Ollama), Cortex cannot interpret prompts

## Links

- [Cortex GitHub](https://github.com/cortexlinux/cortex)
- [Cortex Documentation](https://github.com/cortexlinux/cortex/tree/main/docs)
- [Report Issues](https://github.com/cortexlinux/cortex/issues)

## License

Apache-2.0