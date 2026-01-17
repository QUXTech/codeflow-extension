import * as vscode from 'vscode';
import { ComponentGraph, EditPlan, WebviewMessage, EditStatus } from './types';
import { parseWorkspace } from './parser';
import { buildGraph } from './graph/builder';
import { generateMermaid } from './graph/mermaid';
import { CodeFlowPanel } from './webview/panel';
import { getTerminalMonitor, TerminalMonitor } from './claude/terminalMonitor';
import {
  getUndoManager,
  getPromptTemplateManager,
  getContextSelector,
  getDiffPreviewManager,
  getSessionHistoryManager,
  getCostTracker,
  getBookmarksManager
} from './features';

// Feature manager instances
const undoManager = getUndoManager();
const promptTemplateManager = getPromptTemplateManager();
const contextSelector = getContextSelector();
const diffPreviewManager = getDiffPreviewManager();
const sessionHistoryManager = getSessionHistoryManager();
const costTracker = getCostTracker();
const bookmarksManager = getBookmarksManager();

/** Global state for the extension */
let currentGraph: ComponentGraph | null = null;
let currentPanel: CodeFlowPanel | null = null;
const currentEditPlan: EditPlan | null = null;
let fileWatcher: vscode.FileSystemWatcher | null = null;
let liveEditWatcher: vscode.FileSystemWatcher | null = null;
let terminalMonitor: TerminalMonitor | null = null;

/** Track files currently being edited with timestamps */
const activeEdits: Map<string, { 
  nodeId: string; 
  startTime: number; 
  status: EditStatus;
}> = new Map();

/** Edit history for the activity log */
const editHistory: Array<{
  filePath: string;
  nodeName: string;
  timestamp: number;
  type: 'start' | 'complete';
}> = [];

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('CodeFlow extension activated');

  // Register commands
  const generateMapCommand = vscode.commands.registerCommand(
    'codeflow.generateMap',
    () => generateComponentMap(context)
  );

  const openPanelCommand = vscode.commands.registerCommand(
    'codeflow.openPanel',
    () => openVisualizationPanel(context)
  );

  const refreshMapCommand = vscode.commands.registerCommand(
    'codeflow.refreshMap',
    () => refreshComponentMap()
  );

  const toggleClaudeModeCommand = vscode.commands.registerCommand(
    'codeflow.toggleClaudeMode',
    () => toggleClaudeOrchestration()
  );

  context.subscriptions.push(
    generateMapCommand,
    openPanelCommand,
    refreshMapCommand,
    toggleClaudeModeCommand
  );

  // Set up file watcher for auto-refresh (rebuilds graph)
  setupFileWatcher(context);
  
  // Set up live edit watcher (real-time status updates)
  setupLiveEditWatcher(context);

  // Initialize terminal monitor for Claude CLI auto-approve
  terminalMonitor = getTerminalMonitor();
  terminalMonitor.initialize(context);
  
  // Listen for terminal monitor state changes
  terminalMonitor.onStateChange((state) => {
    if (currentPanel) {
      currentPanel.updateAutoApproveState(state);
    }
    // Record approvals/denials in session history
    if (state.lastAction) {
      if (state.lastAction.type === 'approve') {
        sessionHistoryManager.recordApproval(state.lastAction.file);
      } else if (state.lastAction.type === 'deny') {
        sessionHistoryManager.recordDenial(state.lastAction.file);
      }
    }
  });

  // Initialize all feature managers
  undoManager.initialize(context);
  promptTemplateManager.initialize(context);
  contextSelector.initialize(context);
  diffPreviewManager.initialize(context);
  sessionHistoryManager.initialize(context);
  costTracker.initialize(context);
  bookmarksManager.initialize(context);

  // Connect features to panel updates
  undoManager.onHistoryChange((history) => {
    if (currentPanel) {
      currentPanel.updateUndoHistory(history);
    }
  });

  contextSelector.onSelectionChange((files) => {
    if (currentPanel) {
      currentPanel.updateContextFiles(files);
    }
  });

  diffPreviewManager.onDiffsChange((diffs) => {
    if (currentPanel) {
      currentPanel.updatePendingDiffs(diffs);
    }
  });

  sessionHistoryManager.onHistoryChange((actions, stats) => {
    if (currentPanel) {
      currentPanel.updateSessionInfo(actions, stats);
    }
  });

  costTracker.onCostUpdate((summary) => {
    if (currentPanel) {
      currentPanel.updateCostSummary(summary);
    }
  });

  bookmarksManager.onBookmarksChange((bookmarks) => {
    if (currentPanel) {
      currentPanel.updateBookmarks(bookmarks);
    }
  });

  // Register webview provider for sidebar
  const provider = new CodeFlowViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('codeflow.visualizer', provider)
  );

  // Create status bar item for quick access
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'codeflow.toggleAutoApprove';
  updateStatusBar(statusBarItem);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Update status bar when terminal monitor state changes
  terminalMonitor.onStateChange(() => updateStatusBar(statusBarItem));

  // Create cost tracker status bar
  const costStatusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99
  );
  costStatusBar.command = 'codeflow.showCostSummary';
  costStatusBar.text = '$(credit-card) $0.00';
  costStatusBar.tooltip = 'CodeFlow: Estimated session cost';
  costStatusBar.show();
  context.subscriptions.push(costStatusBar);

  costTracker.onCostUpdate((summary) => {
    costStatusBar.text = `$(credit-card) $${summary.totalCost.toFixed(2)}`;
    costStatusBar.tooltip = `CodeFlow: ~${Math.round(summary.totalTokens / 1000)}k tokens, $${summary.totalCost.toFixed(4)} estimated`;
  });
}

/**
 * Update the status bar item based on auto-approve state
 */
function updateStatusBar(statusBarItem: vscode.StatusBarItem): void {
  if (!terminalMonitor) {return;}
  
  const state = terminalMonitor.getState();
  if (state.enabled) {
    statusBarItem.text = '$(check) CodeFlow: Auto-Yes';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    statusBarItem.tooltip = `Auto-approve is ON\nApproved: ${state.approvedCount} | Denied: ${state.deniedCount}\nClick to toggle`;
  } else {
    statusBarItem.text = '$(circle-slash) CodeFlow: Manual';
    statusBarItem.backgroundColor = undefined;
    statusBarItem.tooltip = 'Auto-approve is OFF\nClick to toggle';
  }
}

/**
 * Generate the component map for the current workspace
 */
async function generateComponentMap(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage('CodeFlow: No workspace folder open');
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'CodeFlow: Scanning project...',
      cancellable: true
    },
    async (progress, token) => {
      try {
        progress.report({ message: 'Parsing files...' });
        
        // Get exclude patterns from settings
        const config = vscode.workspace.getConfiguration('codeflow');
        const excludePatterns = config.get<string[]>('excludePatterns') || [];
        const maxDepth = config.get<number>('maxDepth') || 5;

        // Parse the workspace
        const parseResults = await parseWorkspace(rootPath, excludePatterns, token);
        
        if (token.isCancellationRequested) {
          return;
        }

        progress.report({ message: 'Building dependency graph...' });
        
        // Build the component graph
        currentGraph = buildGraph(parseResults, rootPath, maxDepth);
        
        progress.report({ message: 'Generating visualization...' });
        
        // Open or update the panel
        await openVisualizationPanel(context);
        
        const nodeCount = currentGraph.nodes.length;
        const edgeCount = currentGraph.edges.length;
        vscode.window.showInformationMessage(
          `CodeFlow: Found ${nodeCount} components with ${edgeCount} relationships`
        );
        
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`CodeFlow: Failed to generate map - ${message}`);
        console.error('CodeFlow error:', error);
      }
    }
  );
}

/**
 * Open or focus the visualization panel
 */
async function openVisualizationPanel(context: vscode.ExtensionContext): Promise<void> {
  if (currentPanel) {
    currentPanel.reveal();
  } else {
    currentPanel = new CodeFlowPanel(context, handleWebviewMessage);
  }

  if (currentGraph) {
    const mermaidCode = generateMermaid(currentGraph);
    currentPanel.updateGraph(currentGraph, mermaidCode);
  }
}

/**
 * Refresh the component map
 */
async function refreshComponentMap(): Promise<void> {
  if (!currentPanel) {
    vscode.window.showWarningMessage('CodeFlow: Open the panel first');
    return;
  }

  const context = currentPanel.getContext();
  await generateComponentMap(context);
}

/**
 * Toggle Claude orchestration mode
 */
function toggleClaudeOrchestration(): void {
  // TODO: Implement Claude mode toggle
  vscode.window.showInformationMessage('CodeFlow: Claude orchestration mode coming soon!');
}

/**
 * Handle messages from the webview
 */
function handleWebviewMessage(message: WebviewMessage): void {
  switch (message.type) {
    // Navigation
    case 'nodeClick':
      handleNodeClick(message.payload as { nodeId: string });
      break;
    case 'nodeSelect':
      handleNodeSelect(message.payload as { nodeId: string });
      break;
    case 'requestRefresh':
      vscode.commands.executeCommand('codeflow.refreshMap');
      break;

    // Edit plan
    case 'takeOverEdit':
      handleTakeOverEdit(message.payload as { nodeId: string });
      break;
    case 'skipComponent':
      handleSkipComponent(message.payload as { nodeId: string });
      break;
    case 'cancelPlan':
      handleCancelPlan();
      break;

    // Auto-approve
    case 'approveEdit':
      terminalMonitor?.approveCurrentEdit();
      break;
    case 'denyEdit':
      terminalMonitor?.denyCurrentEdit();
      break;
    case 'toggleAutoApprove':
      terminalMonitor?.toggleAutoApprove();
      break;
    case 'setAutoApprove':
      terminalMonitor?.setAutoApprove((message.payload as { enabled: boolean }).enabled);
      break;

    // Undo/Rollback
    case 'undoFile':
      undoManager.undoFileEdit((message.payload as { filePath: string }).filePath);
      sessionHistoryManager.recordUndo((message.payload as { filePath: string }).filePath);
      break;
    case 'rollbackSession':
      undoManager.rollbackSession();
      break;

    // Prompt templates
    case 'runPromptTemplate':
      promptTemplateManager.runTemplate((message.payload as { templateId: string }).templateId);
      sessionHistoryManager.recordPromptSent((message.payload as { templateId: string }).templateId);
      break;
    case 'showPromptTemplates':
      promptTemplateManager.showTemplateQuickPick();
      break;

    // Context selector
    case 'addToContext': {
      const payload = message.payload as { componentId?: string; filePath?: string };
      if (payload.componentId && currentGraph) {
        contextSelector.addComponentToContext(payload.componentId, currentGraph);
      } else if (payload.filePath) {
        contextSelector.addFileToContext(payload.filePath);
      }
      break;
    }
    case 'removeFromContext':
      contextSelector.removeFileFromContext((message.payload as { filePath: string }).filePath);
      break;
    case 'clearContext':
      contextSelector.clearContext();
      break;
    case 'copyContextReferences':
      contextSelector.copyAsReferences();
      break;
    case 'copyContextContent':
      contextSelector.copyContextContent();
      break;

    // Diff preview
    case 'showDiff':
      diffPreviewManager.showDiffPreview((message.payload as { filePath: string }).filePath);
      break;
    case 'approveDiff':
      diffPreviewManager.approveDiff((message.payload as { diffId: string }).diffId);
      break;
    case 'denyDiff':
      diffPreviewManager.denyDiff((message.payload as { diffId: string }).diffId);
      break;

    // Bookmarks
    case 'addBookmark': {
      const bookmarkPayload = message.payload as { componentId?: string };
      const node = currentGraph?.nodes.find(n => n.id === bookmarkPayload.componentId);
      if (node) {
        bookmarksManager.addComponentBookmark(node);
      } else {
        bookmarksManager.addBookmark();
      }
      break;
    }
    case 'removeBookmark':
      bookmarksManager.removeBookmark((message.payload as { bookmarkId: string }).bookmarkId);
      break;
    case 'goToBookmark':
      bookmarksManager.goToBookmark((message.payload as { bookmarkId: string }).bookmarkId);
      break;
    case 'toggleBookmarkPin':
      bookmarksManager.togglePin((message.payload as { bookmarkId: string }).bookmarkId);
      break;

    // Session
    case 'showSessionHistory':
      sessionHistoryManager.showSessionHistory();
      break;
    case 'exportSessionLog':
      sessionHistoryManager.exportSessionLog();
      break;

    // Cost
    case 'showCostSummary':
      costTracker.showCostSummary();
      break;
    case 'resetCostTracker':
      costTracker.resetTracker();
      break;
  }
}

/**
 * Handle click on a node - navigate to the file
 */
function handleNodeClick(payload: { nodeId: string }): void {
  if (!currentGraph) {return;}

  const node = currentGraph.nodes.find(n => n.id === payload.nodeId);
  if (!node) {return;}

  const uri = vscode.Uri.file(node.filePath);
  const position = new vscode.Position(node.line - 1, node.column);
  
  vscode.window.showTextDocument(uri, {
    selection: new vscode.Range(position, position),
    preserveFocus: false
  });
}

/**
 * Handle selection of a node for editing
 */
function handleNodeSelect(payload: { nodeId: string }): void {
  if (!currentGraph) {return;}

  const node = currentGraph.nodes.find(n => n.id === payload.nodeId);
  if (!node) {return;}

  // Update status to show selection
  vscode.window.showInformationMessage(`CodeFlow: Selected ${node.name} for editing`);
  
  // TODO: Integrate with Claude orchestration
}

/**
 * Handle user taking over an edit
 */
function handleTakeOverEdit(payload: { nodeId: string }): void {
  if (!currentGraph || !currentEditPlan) {return;}

  const node = currentGraph.nodes.find(n => n.id === payload.nodeId);
  if (!node) {return;}

  node.editStatus = 'manual';
  updatePanelStatus();
  
  // Navigate to the file
  handleNodeClick(payload);
}

/**
 * Handle skipping a component in the edit plan
 */
function handleSkipComponent(payload: { nodeId: string }): void {
  if (!currentGraph || !currentEditPlan) {return;}

  const node = currentGraph.nodes.find(n => n.id === payload.nodeId);
  if (!node) {return;}

  node.editStatus = 'skipped';
  updatePanelStatus();
}

/**
 * Handle cancelling the current edit plan
 */
function handleCancelPlan(): void {
  if (!currentEditPlan) {return;}

  currentEditPlan.status = 'cancelled';
  
  // Reset all component statuses
  if (currentGraph) {
    currentGraph.nodes.forEach(node => {
      if (node.editStatus !== 'completed') {
        node.editStatus = 'idle';
      }
    });
  }
  
  updatePanelStatus();
  vscode.window.showInformationMessage('CodeFlow: Edit plan cancelled');
}

/**
 * Update the panel with current status
 */
function updatePanelStatus(): void {
  if (currentPanel && currentGraph) {
    const mermaidCode = generateMermaid(currentGraph);
    currentPanel.updateGraph(currentGraph, mermaidCode);
    
    if (currentEditPlan) {
      currentPanel.updateEditPlan(currentEditPlan);
    }
  }
}

/**
 * Set up file watcher for auto-refresh (rebuilds the entire graph)
 */
function setupFileWatcher(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration('codeflow');
  const autoRefresh = config.get<boolean>('autoRefresh');

  if (!autoRefresh) {return;}

  // Watch for TypeScript, JavaScript, Python, and C# files
  fileWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{ts,tsx,js,jsx,py,cs}'
  );

  let debounceTimer: NodeJS.Timeout | null = null;

  const debouncedRefresh = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    // Longer debounce for full refresh - wait for edits to settle
    debounceTimer = setTimeout(() => {
      if (currentGraph && currentPanel) {
        // Only do full refresh if no active edits for 3 seconds
        const hasRecentEdits = Array.from(activeEdits.values()).some(
          edit => Date.now() - edit.startTime < 3000
        );
        if (!hasRecentEdits) {
          vscode.commands.executeCommand('codeflow.refreshMap');
        }
      }
    }, 3000); // 3 second debounce for full graph rebuild
  };

  fileWatcher.onDidCreate(debouncedRefresh);
  fileWatcher.onDidDelete(debouncedRefresh);

  context.subscriptions.push(fileWatcher);
}

/**
 * Set up live edit watcher for real-time status updates
 * This watches file changes and updates node status immediately
 */
function setupLiveEditWatcher(context: vscode.ExtensionContext): void {
  // Watch for code file changes
  liveEditWatcher = vscode.workspace.createFileSystemWatcher(
    '**/*.{ts,tsx,js,jsx,py,cs}'
  );

  // When a file changes, mark the corresponding node as "editing"
  liveEditWatcher.onDidChange((uri) => {
    handleFileEdit(uri.fsPath);
  });

  context.subscriptions.push(liveEditWatcher);

  // Also watch for document saves to mark edits as "completed"
  const saveWatcher = vscode.workspace.onDidSaveTextDocument((document) => {
    const filePath = document.uri.fsPath;
    handleFileSaved(filePath);
  });

  context.subscriptions.push(saveWatcher);

  // Set up periodic check to transition "editing" -> "completed" after idle time
  const idleChecker = setInterval(() => {
    checkIdleEdits();
  }, 1000);

  context.subscriptions.push({
    dispose: () => clearInterval(idleChecker)
  });
}

/**
 * Handle a file being edited (change detected)
 */
function handleFileEdit(filePath: string): void {
  if (!currentGraph || !currentPanel) {return;}

  // Find the node(s) associated with this file
  const affectedNodes = currentGraph.nodes.filter(
    node => node.filePath === filePath
  );

  if (affectedNodes.length === 0) {return;}

  let statusChanged = false;

  for (const node of affectedNodes) {
    // Track this edit
    activeEdits.set(filePath, {
      nodeId: node.id,
      startTime: Date.now(),
      status: 'editing'
    });

    // Update node status if not already editing
    if (node.editStatus !== 'editing') {
      node.editStatus = 'editing';
      statusChanged = true;

      // Add to history
      editHistory.push({
        filePath,
        nodeName: node.name,
        timestamp: Date.now(),
        type: 'start'
      });

      // Keep history limited
      if (editHistory.length > 100) {
        editHistory.shift();
      }

      console.log(`CodeFlow: Detected edit in ${node.name}`);
    }
  }

  // Update the visualization immediately
  if (statusChanged) {
    updateVisualization();
  }
}

/**
 * Handle a file being saved
 */
function handleFileSaved(filePath: string): void {
  if (!currentGraph || !currentPanel) {return;}

  const activeEdit = activeEdits.get(filePath);
  if (!activeEdit) {return;}

  // Find the node
  const node = currentGraph.nodes.find(n => n.id === activeEdit.nodeId);
  if (!node) {return;}

  // Mark as completed
  node.editStatus = 'completed';
  activeEdit.status = 'completed';

  // Add to history
  editHistory.push({
    filePath,
    nodeName: node.name,
    timestamp: Date.now(),
    type: 'complete'
  });

  console.log(`CodeFlow: Edit completed in ${node.name}`);

  // Update visualization
  updateVisualization();

  // Schedule transition back to idle after a delay
  setTimeout(() => {
    if (node.editStatus === 'completed') {
      node.editStatus = 'idle';
      activeEdits.delete(filePath);
      updateVisualization();
    }
  }, 5000); // Show "completed" status for 5 seconds
}

/**
 * Check for edits that have gone idle (no changes for a while)
 */
function checkIdleEdits(): void {
  if (!currentGraph || !currentPanel) {return;}

  const now = Date.now();
  const idleThreshold = 2000; // 2 seconds without changes
  let statusChanged = false;

  for (const [filePath, edit] of activeEdits.entries()) {
    if (edit.status === 'editing' && now - edit.startTime > idleThreshold) {
      // This edit has gone idle - mark as completed
      const node = currentGraph.nodes.find(n => n.id === edit.nodeId);
      if (node && node.editStatus === 'editing') {
        node.editStatus = 'completed';
        edit.status = 'completed';
        statusChanged = true;

        // Add to history
        editHistory.push({
          filePath,
          nodeName: node.name,
          timestamp: now,
          type: 'complete'
        });

        console.log(`CodeFlow: Edit idle-completed in ${node.name}`);

        // Schedule removal
        setTimeout(() => {
          if (node.editStatus === 'completed') {
            node.editStatus = 'idle';
            activeEdits.delete(filePath);
            updateVisualization();
          }
        }, 5000);
      }
    }
  }

  if (statusChanged) {
    updateVisualization();
  }
}

/**
 * Update the visualization panel with current state
 */
function updateVisualization(): void {
  if (!currentPanel || !currentGraph) {return;}

  const mermaidCode = generateMermaid(currentGraph);
  currentPanel.updateGraph(currentGraph, mermaidCode);

  // Also send edit activity log
  currentPanel.updateEditActivity(getRecentActivity());
}

/**
 * Get recent edit activity for display
 */
function getRecentActivity(): Array<{ nodeName: string; timestamp: number; type: string }> {
  return editHistory
    .slice(-10)
    .reverse()
    .map(e => ({
      nodeName: e.nodeName,
      timestamp: e.timestamp,
      type: e.type
    }));
}

/**
 * Webview provider for the sidebar panel
 */
class CodeFlowViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    // Handle messages from sidebar webview
    webviewView.webview.onDidReceiveMessage(handleWebviewMessage);
  }

  private getWebviewContent(_webview: vscode.Webview): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>CodeFlow</title>
        <style>
          body {
            padding: 10px;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
          }
          .action-button {
            width: 100%;
            padding: 8px;
            margin: 4px 0;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            border-radius: 4px;
          }
          .action-button:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <button class="action-button" onclick="generateMap()">
          Generate Component Map
        </button>
        <button class="action-button" onclick="openPanel()">
          Open Full Visualization
        </button>
        <button class="action-button" onclick="refreshMap()">
          Refresh Map
        </button>
        <div class="info">
          Click "Generate Component Map" to scan your project and visualize component relationships.
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          
          function generateMap() {
            vscode.postMessage({ type: 'requestRefresh' });
          }
          
          function openPanel() {
            vscode.postMessage({ type: 'nodeClick', payload: { nodeId: '__open_panel__' } });
          }
          
          function refreshMap() {
            vscode.postMessage({ type: 'requestRefresh' });
          }
        </script>
      </body>
      </html>
    `;
  }
}

/**
 * Extension deactivation
 */
export function deactivate() {
  if (fileWatcher) {
    fileWatcher.dispose();
  }
  if (liveEditWatcher) {
    liveEditWatcher.dispose();
  }
  if (currentPanel) {
    currentPanel.dispose();
  }
  if (terminalMonitor) {
    terminalMonitor.dispose();
  }
  
  // Dispose feature managers
  undoManager.dispose();
  contextSelector.dispose();
  diffPreviewManager.dispose();
  sessionHistoryManager.dispose();
  costTracker.dispose();
  bookmarksManager.dispose();
  
  activeEdits.clear();
  editHistory.length = 0;
}
