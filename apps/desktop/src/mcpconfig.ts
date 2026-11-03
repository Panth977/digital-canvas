/** Ready-made client configs for the Settings dialog (also sent to the window). */
export interface ClientConfig { id: string; label: string; hint: string; text: string }

export function clientConfigs(url: string, token: string): ClientConfig[] {
  const auth = `Bearer ${token}`;
  const json = (o: unknown) => JSON.stringify(o, null, 2);
  return [
    { id: 'claude-code', label: 'Claude Code', hint: 'Run in a terminal.', text: `claude mcp add --transport http digital-canvas ${url} --header "Authorization: ${auth}"` },
    { id: 'cursor', label: 'Cursor', hint: 'Add to ~/.cursor/mcp.json.', text: json({ mcpServers: { 'digital-canvas': { url, headers: { Authorization: auth } } } }) },
    { id: 'vscode', label: 'VS Code', hint: 'Add to .vscode/mcp.json.', text: json({ servers: { 'digital-canvas': { type: 'http', url, headers: { Authorization: auth } } } }) },
    { id: 'gemini-cli', label: 'Gemini CLI', hint: 'Run in a terminal (or add the same to ~/.gemini/settings.json under mcpServers).', text: `gemini mcp add --transport http digital-canvas ${url} --header "Authorization: ${auth}"` },
    { id: 'antigravity', label: 'Antigravity', hint: 'Agent panel › … › MCP Servers › Manage › View raw config (~/.gemini/antigravity/mcp_config.json).', text: json({ mcpServers: { 'digital-canvas': { serverUrl: url, headers: { Authorization: auth } } } }) },
    { id: 'windsurf', label: 'Windsurf', hint: 'Add to ~/.codeium/windsurf/mcp_config.json.', text: json({ mcpServers: { 'digital-canvas': { serverUrl: url, headers: { Authorization: auth } } } }) },
    { id: 'claude-desktop', label: 'Claude Desktop', hint: 'Add to claude_desktop_config.json. It speaks stdio, so mcp-remote carries it (needs Node).', text: json({ mcpServers: { 'digital-canvas': { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization:${auth}`] } } }) },
    { id: 'other', label: 'Other', hint: 'Any client with Streamable HTTP.', text: `URL:    ${url}\nHeader: Authorization: ${auth}` },
  ];
}
