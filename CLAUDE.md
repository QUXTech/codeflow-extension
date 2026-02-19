# CodeFlow VS Code Extension

| Field | Value |
|-------|-------|
| **Repository** | `/opt/codeflow-extension` |
| **Technology** | TypeScript / VS Code Extension API |
| **Version** | 0.1.0 |
| **Publisher** | QUXTech |
| **VS Code** | ^1.85.0 |

---

## Purpose

Visual Component Map for VS Code. Visualizes codebase as interactive Mermaid diagrams with AI-assisted navigation via Claude CLI integration.

---

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `codeflow.generateMap` | — | Generate component map |
| `codeflow.openPanel` | — | Open visualization panel |
| `codeflow.refreshMap` | — | Refresh component map |
| `codeflow.toggleClaudeMode` | — | Toggle Claude orchestration |
| `codeflow.approveEdit` | Ctrl+Shift+Y | Approve Claude edit |
| `codeflow.denyEdit` | Ctrl+Shift+N | Reject Claude edit |
| `codeflow.toggleAutoApprove` | — | Auto-approve toggle |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `codeflow.autoRefresh` | true | Auto-refresh on file changes |
| `codeflow.excludePatterns` | node_modules, dist, build, .git | File exclusion patterns |
| `codeflow.maxDepth` | 5 | Max dependency traversal depth |
| `codeflow.claudeApiKey` | — | Anthropic API key |
| `codeflow.autoApproveEdits` | false | Auto-approve Claude edits |
| `codeflow.terminalName` | "claude" | Terminal to monitor |

---

## Dependencies

- **Mermaid** 11.12.2 — Diagram generation
- **Glob** 10.3.10 — File pattern matching
- **TypeScript** 5.3.0

---

## Build & Deploy

```bash
cd /opt/codeflow-extension

# Compile TypeScript
npm run compile

# Watch mode
npm run watch

# Package extension (.vsix)
npm run package

# Install locally
code --install-extension codeflow-0.1.0.vsix --force
```

---

## Important Notes

- **VSIX install**: Install with `code --install-extension` from VS Code Server CLI
- **Claude integration**: Monitors Claude CLI terminal for edit suggestions
- **Mermaid rendering**: Interactive diagrams in webview panel

---

*Last Updated: January 31, 2026*
