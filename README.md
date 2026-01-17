# CodeFlow - Visual Component Map for VS Code

[![CI](https://github.com/QUXTech/codeflow-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/QUXTech/codeflow-extension/actions/workflows/ci.yml)

**Visualize your codebase as an interactive component diagram. Navigate, understand, and orchestrate code edits with AI assistance.**

![CodeFlow Demo](media/demo.gif)

## Features

### 🗺️ Component Visualization
- **Auto-detect components** - Scans your project for React components, classes, services, hooks, and more
- **Dependency mapping** - Shows import/export relationships between components
- **Interactive Mermaid diagrams** - Click any node to jump directly to that file
- **Multi-language support** - TypeScript, JavaScript, React, Python, and C# (Unity)

### 🎯 Smart Navigation
- **Click to navigate** - Single click jumps to the file
- **Focused views** - Filter the diagram around a specific component
- **Component sidebar** - Browse all components in a searchable list
- **Type-based grouping** - Components organized by type (services, hooks, API, etc.)

### 🤖 Claude Integration (Coming Soon)
- **Visual edit orchestration** - See Claude's edit plan before execution
- **Real-time progress** - Watch as Claude works through components
- **Take over control** - Click any component to edit it yourself
- **Skip or cancel** - Full control over the automation

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "CodeFlow"
4. Click Install

### From Source
```bash
git clone https://github.com/yourusername/codeflow
cd codeflow-extension
npm install
npm run compile
```

Then press F5 in VS Code to launch the extension in development mode.

## Usage

### Generate a Component Map

1. Open a project in VS Code
2. Open the Command Palette (Ctrl+Shift+P)
3. Run "CodeFlow: Generate Component Map"
4. The visualization panel opens with your component diagram

### Navigate Your Code

- **Click a node** - Opens that file at the component definition
- **Double-click in sidebar** - Same navigation behavior
- **Zoom controls** - Use +/- buttons or scroll to zoom
- **Pan** - Click and drag to move around the diagram

### Understand Relationships

The diagram shows different relationship types:
- **Solid arrows** (→) - Import relationships
- **Dotted arrows** (⇢) - Re-exports
- **Thick arrows** (⇒) - Inheritance (extends)

### Component Types

Components are color-coded by type:
- 🔵 **Component** - React/Vue components
- 🟢 **Service** - Service classes
- 🟠 **Hook** - React hooks
- 🟣 **Context/Store** - State management
- 🔴 **API** - API layer
- 🔷 **Utility** - Helper functions

## Configuration

Open VS Code settings and search for "CodeFlow":

| Setting | Default | Description |
|---------|---------|-------------|
| `codeflow.autoRefresh` | `true` | Auto-refresh when files change |
| `codeflow.excludePatterns` | `["**/node_modules/**", ...]` | Patterns to exclude from scanning |
| `codeflow.maxDepth` | `5` | Maximum dependency traversal depth |
| `codeflow.claudeApiKey` | `""` | Anthropic API key for Claude integration |

## Supported Languages

| Language | File Extensions | Detection |
|----------|-----------------|-----------|
| TypeScript | `.ts` | Classes, functions, exports |
| React/TSX | `.tsx`, `.jsx` | Components, hooks, context |
| JavaScript | `.js` | Classes, functions, exports |
| Python | `.py` | Classes, functions, imports |
| C# | `.cs` | Classes, interfaces, Unity MonoBehaviours |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+P` → "CodeFlow" | Access all commands |
| Click node | Navigate to file |
| `+` / `-` | Zoom in/out |
| `⬜` | Fit to view |

## Roadmap

- [x] Basic component detection
- [x] Mermaid diagram generation
- [x] Click-to-navigate
- [x] Multi-language support
- [ ] Claude orchestration integration
- [ ] Team collaboration features
- [ ] Custom component detection rules
- [ ] Export to documentation

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

```bash
# Setup development environment
npm install

# Run in development mode
npm run watch

# Run tests
npm test

# Package for distribution
npm run package
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Mermaid.js](https://mermaid-js.github.io/) for diagram rendering
- [VS Code Extension API](https://code.visualstudio.com/api) documentation
- The Anthropic team for Claude

---

**Made with ❤️ for developers who want to understand their code better.**
