import * as vscode from 'vscode';

const TERMINAL_NAME = 'Cortex';
const SETUP_COMPLETE_KEY = 'cortex.setupComplete';
const ANTHROPIC_KEY = 'cortex.anthropicApiKey';
const OPENAI_KEY = 'cortex.openaiApiKey';

let cortexTerminal: vscode.Terminal | undefined;
let panelProvider: CortexPanelProvider | undefined;
let statusBarItem: vscode.StatusBarItem;
let extensionContext: vscode.ExtensionContext;

// Platform detection result
interface PlatformInfo {
	supported: boolean;
	platform: 'linux' | 'wsl' | 'macos' | 'windows' | 'unknown';
	message: string;
}

// API Key status
interface ApiKeyStatus {
	hasAnthropicKey: boolean;
	hasOpenAiKey: boolean;
	provider: string;
	isOllama: boolean;
}

export function activate(context: vscode.ExtensionContext) {
	extensionContext = context;
	panelProvider = new CortexPanelProvider(context.extensionUri, context);

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'cortex.checkStatus';
	context.subscriptions.push(statusBarItem);

	const disposables = [
		vscode.window.registerWebviewViewProvider('cortex.panel', panelProvider),
		
		vscode.commands.registerCommand('cortex.openPanel', () => {
			vscode.commands.executeCommand('cortex.panel.focus');
		}),
		
		vscode.commands.registerCommand('cortex.runCommand', async () => {
			const platform = detectPlatform();
			if (!platform.supported) {
				vscode.window.showErrorMessage(platform.message);
				return;
			}
			
			const input = await vscode.window.showInputBox({
				prompt: 'What do you want to install or do?',
				placeHolder: 'e.g., nginx with SSL support, or: cortex history'
			});
			
			if (input) {
				const command = buildCommand(input);
				const terminal = getOrCreateTerminal();
				terminal.show(true);
				terminal.sendText(command);
			}
		}),
		
		vscode.commands.registerCommand('cortex.setApiKey', async () => {
			await setApiKey(context);
		}),
		
		vscode.commands.registerCommand('cortex.clearApiKey', async () => {
			await clearApiKey(context);
		}),
		
		vscode.commands.registerCommand('cortex.checkStatus', async () => {
			await showStatusDetails(context);
		}),
		
		vscode.window.onDidCloseTerminal(terminal => {
			if (terminal === cortexTerminal) {
				cortexTerminal = undefined;
			}
		}),
		
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('cortex')) {
				updateStatusBar(context);
			}
		})
	];

	context.subscriptions.push(...disposables);

	// Initialize status bar
	updateStatusBar(context);
}

export function deactivate() {
	cortexTerminal = undefined;
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}

async function updateStatusBar(context: vscode.ExtensionContext) {
	const platform = detectPlatform();
	const apiStatus = await getApiKeyStatus(context);

	if (!platform.supported) {
		statusBarItem.text = '$(error) Cortex: Unsupported Platform';
		statusBarItem.tooltip = platform.message;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
	} else if (apiStatus.isOllama) {
		statusBarItem.text = '$(check) Cortex: Ollama';
		statusBarItem.tooltip = 'Using local Ollama (no API key required)';
		statusBarItem.backgroundColor = undefined;
	} else if (apiStatus.hasAnthropicKey || apiStatus.hasOpenAiKey) {
		const provider = apiStatus.hasAnthropicKey ? 'Anthropic' : 'OpenAI';
		statusBarItem.text = `$(check) Cortex: ${provider}`;
		statusBarItem.tooltip = `Connected to ${provider} API`;
		statusBarItem.backgroundColor = undefined;
	} else {
		statusBarItem.text = '$(warning) Cortex: No API Key';
		statusBarItem.tooltip = 'Click to configure API key';
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}

	statusBarItem.show();
}

async function getApiKeyStatus(context: vscode.ExtensionContext): Promise<ApiKeyStatus> {
	const config = vscode.workspace.getConfiguration('cortex');
	const provider = config.get<string>('llmProvider', 'anthropic');
	const isOllama = provider === 'ollama';

	const anthropicKey = await context.secrets.get(ANTHROPIC_KEY);
	const openaiKey = await context.secrets.get(OPENAI_KEY);

	return {
		hasAnthropicKey: !!anthropicKey,
		hasOpenAiKey: !!openaiKey,
		provider,
		isOllama
	};
}

async function setApiKey(context: vscode.ExtensionContext) {
	const provider = await vscode.window.showQuickPick(
		[
			{ label: 'Anthropic (Claude)', value: 'anthropic', description: 'Recommended' },
			{ label: 'OpenAI (GPT-4)', value: 'openai', description: 'Alternative' },
			{ label: 'Ollama (Local)', value: 'ollama', description: 'Free, no API key needed' }
		],
		{ placeHolder: 'Select your LLM provider' }
	);

	if (!provider) {
		return;
	}

	// Update config
	const config = vscode.workspace.getConfiguration('cortex');
	await config.update('llmProvider', provider.value, vscode.ConfigurationTarget.Global);

	if (provider.value === 'ollama') {
		vscode.window.showInformationMessage('Ollama selected. Make sure Ollama is running locally.');
		await updateStatusBar(context);
		if (panelProvider) {
			panelProvider.notifyApiKeyChange();
		}
		return;
	}

	const keyLabel = provider.value === 'anthropic' ? 'Anthropic' : 'OpenAI';
	const keyPrefix = provider.value === 'anthropic' ? 'sk-ant-' : 'sk-';

	const apiKey = await vscode.window.showInputBox({
		prompt: `Enter your ${keyLabel} API key`,
		placeHolder: `${keyPrefix}...`,
		password: true,
		validateInput: (value) => {
			if (!value || value.trim().length === 0) {
				return 'API key cannot be empty';
			}
			return null;
		}
	});

	if (!apiKey) {
		return;
	}

	const secretKey = provider.value === 'anthropic' ? ANTHROPIC_KEY : OPENAI_KEY;
	await context.secrets.store(secretKey, apiKey.trim());

	vscode.window.showInformationMessage(`${keyLabel} API key saved securely.`);
	await updateStatusBar(context);

	if (panelProvider) {
		panelProvider.notifyApiKeyChange();
	}
}

async function clearApiKey(context: vscode.ExtensionContext) {
	const choice = await vscode.window.showQuickPick(
		[
			{ label: 'Anthropic API Key', value: ANTHROPIC_KEY },
			{ label: 'OpenAI API Key', value: OPENAI_KEY },
			{ label: 'Both', value: 'both' }
		],
		{ placeHolder: 'Which API key do you want to clear?' }
	);

	if (!choice) {
		return;
	}

	if (choice.value === 'both') {
		await context.secrets.delete(ANTHROPIC_KEY);
		await context.secrets.delete(OPENAI_KEY);
		vscode.window.showInformationMessage('All API keys cleared.');
	} else {
		await context.secrets.delete(choice.value);
		vscode.window.showInformationMessage('API key cleared.');
	}

	await updateStatusBar(context);
	if (panelProvider) {
		panelProvider.notifyApiKeyChange();
	}
}

async function showStatusDetails(context: vscode.ExtensionContext) {
	const platform = detectPlatform();
	const apiStatus = await getApiKeyStatus(context);

	let message = `**Platform:** ${platform.platform}\n`;
	message += `**Supported:** ${platform.supported ? 'Yes' : 'No'}\n`;
	message += `**Provider:** ${apiStatus.provider}\n`;

	if (apiStatus.isOllama) {
		message += `**Status:** Using local Ollama`;
	} else if (apiStatus.provider === 'anthropic') {
		message += `**Anthropic Key:** ${apiStatus.hasAnthropicKey ? 'Configured ✓' : 'Not set ✗'}`;
	} else {
		message += `**OpenAI Key:** ${apiStatus.hasOpenAiKey ? 'Configured ✓' : 'Not set ✗'}`;
	}

	const action = await vscode.window.showInformationMessage(
		message.replaceAll('**', '').replaceAll('\n', ' | '),
		'Set API Key',
		'Open Settings'
	);

	if (action === 'Set API Key') {
		vscode.commands.executeCommand('cortex.setApiKey');
	} else if (action === 'Open Settings') {
		vscode.commands.executeCommand('workbench.action.openSettings', 'cortex');
	}
}

function getOrCreateTerminal(): vscode.Terminal {
	if (cortexTerminal && cortexTerminal.exitStatus === undefined) {
		return cortexTerminal;
	}

	const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
	if (existing && existing.exitStatus === undefined) {
		cortexTerminal = existing;
		return cortexTerminal;
	}

	// For WSL on Windows, we might want to use WSL terminal
	const platform = detectPlatform();
	if (platform.platform === 'wsl' || (process.platform === 'win32' && isWslRemote())) {
		cortexTerminal = vscode.window.createTerminal({
			name: TERMINAL_NAME,
			shellPath: 'wsl.exe'
		});
	} else {
		cortexTerminal = vscode.window.createTerminal({ name: TERMINAL_NAME });
	}

	return cortexTerminal;
}

function detectPlatform(): PlatformInfo {
	const platform = process.platform;
	const remoteName = vscode.env.remoteName;

	// Check if we're in a WSL remote
	if (remoteName === 'wsl') {
		return { supported: true, platform: 'wsl', message: '' };
	}

	// Check if we're in a remote SSH session (could be Linux server)
	if (remoteName === 'ssh-remote') {
		return { supported: true, platform: 'linux', message: '' };
	}

	// Check if in Dev Container (likely Linux)
	if (remoteName === 'dev-container' || remoteName === 'attached-container') {
		return { supported: true, platform: 'linux', message: '' };
	}

	// Native Linux
	if (platform === 'linux') {
		return { supported: true, platform: 'linux', message: '' };
	}

	// Windows without WSL remote - could still work if they open WSL terminal
	if (platform === 'win32') {
		// Check if WSL is available
		if (isWslAvailable()) {
			return {
				supported: true,
				platform: 'wsl',
				message: 'Running on Windows with WSL support. Commands will execute in WSL.'
			};
		}
		return {
			supported: false,
			platform: 'windows',
			message: 'Cortex requires Linux. Please install WSL (Windows Subsystem for Linux) or use the WSL remote in VS Code.'
		};
	}

	// macOS - according to acceptance criteria, should work
	if (platform === 'darwin') {
		return {
			supported: false,
			platform: 'macos',
			message: 'Cortex is designed for Linux package management. macOS is not directly supported, but you can use a Linux VM or container.'
		};
	}

	return {
		supported: false,
		platform: 'unknown',
		message: 'Cortex requires a Linux environment.'
	};
}

function isWslRemote(): boolean {
	return vscode.env.remoteName === 'wsl';
}

function isWslAvailable(): boolean {
	// On Windows, check common indicators of WSL availability
	// This is a heuristic - WSL_DISTRO_NAME is set inside WSL shells
	const hasWslEnv = !!process.env.WSL_DISTRO_NAME || !!process.env.WSLENV;
	// Most Windows systems with WSL have these paths
	const fs = require('node:fs');
	try {
		return hasWslEnv || fs.existsSync(String.raw`C:\Windows\System32\wsl.exe`);
	} catch {
		return hasWslEnv;
	}
}

function buildCommand(input: string): string {
	const lower = input.toLowerCase();

	if (lower.startsWith('cortex ')) {
		return input;
	}

	if (lower === 'history' || lower === 'status' || lower === 'wizard') {
		return `cortex ${input}`;
	}

	if (lower.startsWith('rollback ')) {
		return `cortex ${input}`;
	}

	return `cortex install "${input}" --dry-run`;
}

class CortexPanelProvider implements vscode.WebviewViewProvider {
	private view?: vscode.WebviewView;
	private readonly extensionUri: vscode.Uri;
	private readonly context: vscode.ExtensionContext;

	constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
		this.extensionUri = extensionUri;
		this.context = context;
	}

	notifyApiKeyChange() {
		this.checkEnvironment();
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.extensionUri]
		};

		webviewView.webview.html = this.getHtml();

		webviewView.webview.onDidReceiveMessage(async message => {
			switch (message.type) {
				case 'submit':
					await this.handlePrompt(message.text);
					break;
				case 'ready':
					await this.checkEnvironment();
					break;
				case 'confirmSetup':
					await this.confirmSetup();
					break;
				case 'resetSetup':
					await this.resetSetup();
					break;
				case 'setApiKey':
					await vscode.commands.executeCommand('cortex.setApiKey');
					break;
				case 'selectProvider':
					await this.selectProvider(message.provider);
					break;
			}
		});
	}

	private async selectProvider(provider: string) {
		const config = vscode.workspace.getConfiguration('cortex');
		await config.update('llmProvider', provider, vscode.ConfigurationTarget.Global);

		if (provider === 'ollama') {
			await this.context.globalState.update(SETUP_COMPLETE_KEY, true);
			this.postMessage({ type: 'ready' });
			await updateStatusBar(this.context);
		} else {
			// Prompt for API key
			await vscode.commands.executeCommand('cortex.setApiKey');
		}
	}

	private async checkEnvironment() {
		const platform = detectPlatform();
		if (!platform.supported) {
			this.postMessage({ type: 'error', text: platform.message, disableInput: true });
			return;
		}

		const apiStatus = await getApiKeyStatus(this.context);
		const setupComplete = this.context.globalState.get<boolean>(SETUP_COMPLETE_KEY, false);

		// Check if API is configured
		const hasValidConfig = apiStatus.isOllama || 
			(apiStatus.provider === 'anthropic' && apiStatus.hasAnthropicKey) ||
			(apiStatus.provider === 'openai' && apiStatus.hasOpenAiKey);

		if (!hasValidConfig && !setupComplete) {
			this.postMessage({
				type: 'apiKeySetup',
				text: this.getApiKeySetupMessage(),
				provider: apiStatus.provider,
				disableInput: true
			});
			return;
		}

		if (!setupComplete) {
			this.postMessage({
				type: 'onboarding',
				text: this.getOnboardingMessage(),
				disableInput: true
			});
			return;
		}

		this.postMessage({ type: 'ready' });
	}

	private async confirmSetup() {
		await this.context.globalState.update(SETUP_COMPLETE_KEY, true);
		this.postMessage({ type: 'ready' });
	}

	private async resetSetup() {
		await this.context.globalState.update(SETUP_COMPLETE_KEY, false);
		await this.checkEnvironment();
	}

	private async handlePrompt(text: string) {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}

		this.postMessage({ type: 'user', text: trimmed });

		const terminal = getOrCreateTerminal();
		terminal.show(true);

		const command = buildCommand(trimmed);
		terminal.sendText(command);

		this.postMessage({ type: 'sent', command: command });
	}

	private postMessage(message: unknown) {
		if (this.view) {
			this.view.webview.postMessage(message);
		}
	}

	private getApiKeySetupMessage(): string {
		return `
## Configure API Key

Cortex needs an LLM provider to understand your natural language requests.

### Choose your provider:

**Anthropic Claude** (Recommended)
- Best quality responses
- Requires API key from [console.anthropic.com](https://console.anthropic.com)

**OpenAI GPT-4** 
- Good alternative
- Requires API key from [platform.openai.com](https://platform.openai.com)

**Ollama** (Free)
- Runs locally on your machine
- No API key required
- Requires Ollama installed locally

Click the button below to configure your API key.
		`.trim();
	}

	private getOnboardingMessage(): string {
		return `
## Welcome to Cortex AI

Cortex is an AI-powered package manager for Linux that understands natural language.

### Setup Instructions

1. **Install Cortex CLI** (if not already installed)
   \`\`\`
   git clone https://github.com/cortexlinux/cortex.git
   cd cortex
   python3 -m venv venv
   source venv/bin/activate
   pip install -e .
   \`\`\`

2. **Verify installation**
   \`\`\`
   cortex --version
   \`\`\`

Your API key is already configured. Click the button below when Cortex CLI is installed.
		`.trim();
	}

	private getHtml(): string {
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Cortex AI</title>
<style>
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}
html, body {
	height: 100%;
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-foreground);
	background: var(--vscode-sideBar-background);
}
.container {
	display: flex;
	flex-direction: column;
	height: 100%;
}
.output {
	flex: 1;
	overflow-y: auto;
	padding: 12px;
}
.message {
	margin-bottom: 12px;
	padding: 8px 12px;
	border-radius: 6px;
	white-space: pre-wrap;
	word-wrap: break-word;
	font-family: var(--vscode-editor-font-family), monospace;
	font-size: 13px;
	line-height: 1.5;
}
.message.user {
	background: var(--vscode-input-background);
	border-left: 3px solid var(--vscode-textLink-foreground);
}
.message.cortex {
	background: var(--vscode-editor-background);
}
.message.error {
	background: var(--vscode-inputValidation-errorBackground);
	border-left: 3px solid var(--vscode-inputValidation-errorBorder);
}
.message.onboarding,
.message.apikey-setup {
	background: var(--vscode-editor-background);
	border: 1px solid var(--vscode-widget-border);
}
.message h2 {
	margin-bottom: 12px;
	font-size: 16px;
}
.message h3 {
	margin: 16px 0 8px;
	font-size: 14px;
}
.message ol, .message ul {
	padding-left: 20px;
}
.message li {
	margin-bottom: 12px;
}
.message code,
.message pre {
	background: var(--vscode-textBlockQuote-background);
	padding: 2px 6px;
	border-radius: 3px;
	font-family: var(--vscode-editor-font-family), monospace;
}
.message pre {
	display: block;
	padding: 8px;
	margin: 8px 0;
	overflow-x: auto;
}
.message a {
	color: var(--vscode-textLink-foreground);
}
.message strong {
	color: var(--vscode-textLink-foreground);
}
.provider-buttons {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-top: 16px;
}
.provider-btn {
	padding: 10px 16px;
	background: var(--vscode-button-secondaryBackground);
	color: var(--vscode-button-secondaryForeground);
	border: 1px solid var(--vscode-widget-border);
	border-radius: 4px;
	cursor: pointer;
	text-align: left;
	font-size: 13px;
}
.provider-btn:hover {
	background: var(--vscode-button-secondaryHoverBackground);
}
.provider-btn.primary {
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: none;
}
.provider-btn.primary:hover {
	background: var(--vscode-button-hoverBackground);
}
.status {
	padding: 4px 12px;
	font-size: 12px;
	color: var(--vscode-descriptionForeground);
}
.input-area {
	padding: 12px;
	border-top: 1px solid var(--vscode-widget-border);
	background: var(--vscode-sideBar-background);
}
.input-wrapper {
	display: flex;
	gap: 8px;
}
input {
	flex: 1;
	padding: 8px 12px;
	border: 1px solid var(--vscode-input-border);
	border-radius: 4px;
	background: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	font-family: inherit;
	font-size: inherit;
}
input:focus {
	outline: 1px solid var(--vscode-focusBorder);
}
input:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
button {
	padding: 8px 16px;
	border: none;
	border-radius: 4px;
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	cursor: pointer;
	font-family: inherit;
	font-size: inherit;
}
button:hover {
	background: var(--vscode-button-hoverBackground);
}
button:disabled {
	opacity: 0.5;
	cursor: not-allowed;
}
.hint {
	margin-top: 8px;
	font-size: 11px;
	color: var(--vscode-descriptionForeground);
}
.hint a {
	color: var(--vscode-textLink-foreground);
	cursor: pointer;
	text-decoration: none;
}
.hint a:hover {
	text-decoration: underline;
}
.setup-btn {
	margin-top: 16px;
	padding: 10px 20px;
	background: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: none;
	border-radius: 4px;
	cursor: pointer;
	font-size: 13px;
}
.setup-btn:hover {
	background: var(--vscode-button-hoverBackground);
}
</style>
</head>
<body>
<div class="container">
	<div class="output" id="output"></div>
	<div class="input-area">
		<div class="input-wrapper">
			<input type="text" id="input" placeholder="Describe what you want to install..." disabled>
			<button id="submit" disabled>Send</button>
		</div>
		<div class="hint">Example: "nginx with SSL" or "docker and docker-compose" | <a id="resetSetup">Reset setup</a></div>
	</div>
</div>
<script>
(function() {
	const vscode = acquireVsCodeApi();
	const output = document.getElementById('output');
	const input = document.getElementById('input');
	const submit = document.getElementById('submit');
	const resetSetup = document.getElementById('resetSetup');

	function appendMessage(className, content, options = {}) {
		const div = document.createElement('div');
		div.className = 'message ' + className;

		if (className === 'onboarding' || className === 'apikey-setup') {
			div.innerHTML = parseMarkdown(content);
			
			if (options.showSetupBtn) {
				const btn = document.createElement('button');
				btn.className = 'setup-btn';
				btn.textContent = 'I have completed setup';
				btn.onclick = function() {
					vscode.postMessage({ type: 'confirmSetup' });
				};
				div.appendChild(btn);
			}
			
			if (options.showProviderButtons) {
				const btnContainer = document.createElement('div');
				btnContainer.className = 'provider-buttons';
				
				const anthropicBtn = document.createElement('button');
				anthropicBtn.className = 'provider-btn primary';
				anthropicBtn.innerHTML = '<strong>Anthropic Claude</strong> - Recommended';
				anthropicBtn.onclick = () => vscode.postMessage({ type: 'setApiKey' });
				
				const openaiBtn = document.createElement('button');
				openaiBtn.className = 'provider-btn';
				openaiBtn.innerHTML = '<strong>OpenAI GPT-4</strong> - Alternative';
				openaiBtn.onclick = () => vscode.postMessage({ type: 'setApiKey' });
				
				const ollamaBtn = document.createElement('button');
				ollamaBtn.className = 'provider-btn';
				ollamaBtn.innerHTML = '<strong>Ollama</strong> - Free, local';
				ollamaBtn.onclick = () => vscode.postMessage({ type: 'selectProvider', provider: 'ollama' });
				
				btnContainer.appendChild(anthropicBtn);
				btnContainer.appendChild(openaiBtn);
				btnContainer.appendChild(ollamaBtn);
				div.appendChild(btnContainer);
			}
		} else {
			div.textContent = content;
		}

		output.appendChild(div);
		output.scrollTop = output.scrollHeight;
		return div;
	}

	function parseMarkdown(text) {
		return text
			.replace(/^## (.+)$/gm, '<h2>$1</h2>')
			.replace(/^### (.+)$/gm, '<h3>$1</h3>')
			.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre>$1</pre>')
			.replace(/\`([^\`]+)\`/g, '<code>$1</code>')
			.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
			.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
			.replace(/^(\\d+\\.) /gm, '<li>')
			.replace(/<li>([^<]+)(?=<li>|$)/g, '<li>$1</li>');
	}

	function enableInput() {
		input.disabled = false;
		submit.disabled = false;
		input.focus();
	}

	function disableInput() {
		input.disabled = true;
		submit.disabled = true;
	}

	function sendPrompt() {
		const text = input.value.trim();
		if (!text) return;

		vscode.postMessage({ type: 'submit', text: text });
		input.value = '';
	}

	submit.addEventListener('click', sendPrompt);
	input.addEventListener('keydown', e => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendPrompt();
		}
	});

	resetSetup.addEventListener('click', function(e) {
		e.preventDefault();
		vscode.postMessage({ type: 'resetSetup' });
	});

	window.addEventListener('message', event => {
		const message = event.data;

		switch (message.type) {
			case 'ready':
				output.innerHTML = '';
				enableInput();
				break;

			case 'error':
				appendMessage('error', message.text, { showSetupBtn: false });
				if (message.disableInput) disableInput();
				break;

			case 'apiKeySetup':
				output.innerHTML = '';
				appendMessage('apikey-setup', message.text, { showProviderButtons: true });
				if (message.disableInput) disableInput();
				break;

			case 'onboarding':
				output.innerHTML = '';
				appendMessage('onboarding', message.text, { showSetupBtn: true });
				if (message.disableInput) disableInput();
				break;

			case 'user':
				appendMessage('user', message.text);
				break;

			case 'sent':
				appendMessage('cortex', 'Command sent to terminal:\\n' + message.command);
				break;
		}
	});

	vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
	}
}
