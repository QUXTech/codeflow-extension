import * as vscode from 'vscode';
import { ComponentGraph, EditPlan, WebviewMessage, EditStatus, FolderSelection } from './types';
import { parseWorkspace, discoverFolders, getSelectedFolderPaths } from './parser';
import { buildGraph } from './graph/builder';
import { generateMermaid } from './graph/mermaid';
import { CodeFlowPanel } from './webview/panel';
import { getTerminalMonitor, TerminalMonitor } from './claude/terminalMonitor';
import { getClaudeFlowMcp, ClaudeFlowMcp, EditTask } from './claude/claudeFlowMcp';
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
let claudeFlowMcp: ClaudeFlowMcp | null = null;

/** Selected components for editing */
const selectedComponents: Set<string> = new Set();

/** Folder selection state for component map filtering */
let folderSelections: FolderSelection[] = [];

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

  // Initialize Claude Flow MCP integration
  claudeFlowMcp = getClaudeFlowMcp();
  claudeFlowMcp.initialize(context).then(connected => {
    if (connected) {
      console.log('CodeFlow: Claude Flow MCP connected');
      vscode.window.showInformationMessage('CodeFlow: Connected to Claude Flow');
    }
  });

  // Listen for Claude Flow task updates
  claudeFlowMcp.onTaskUpdate((task: EditTask) => {
    if (currentPanel) {
      currentPanel.updateClaudeFlowTask(task);
    }
    // Sync component status with task progress
    if (currentGraph) {
      claudeFlowMcp?.syncComponentStatus(currentGraph, (nodeId, status) => {
        const node = currentGraph?.nodes.find(n => n.id === nodeId);
        if (node) {
          node.editStatus = status;
        }
      });
      updateVisualization();
    }
  });
  
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
        progress.report({ message: 'Discovering folders...' });

        // Get exclude patterns from settings
        const config = vscode.workspace.getConfiguration('codeflow');
        const excludePatterns = config.get<string[]>('excludePatterns') || [];
        const maxDepth = config.get<number>('maxDepth') || 5;

        // Discover folders if not already done
        if (folderSelections.length === 0) {
          folderSelections = await discoverFolders(rootPath, maxDepth);
        }

        // Get the selected folder paths
        const selectedFolders = getSelectedFolderPaths(folderSelections);

        progress.report({ message: 'Parsing files...' });

        // Parse the workspace with selected folders
        const parseResults = await parseWorkspace(rootPath, excludePatterns, selectedFolders, token);

        if (token.isCancellationRequested) {
          return;
        }

        progress.report({ message: 'Building dependency graph...' });

        // Build the component graph
        currentGraph = buildGraph(parseResults, rootPath, maxDepth);

        progress.report({ message: 'Generating visualization...' });

        // Open or update the panel
        await openVisualizationPanel(context);

        // Send folder selection state to panel
        if (currentPanel) {
          currentPanel.updateFolderSelection(folderSelections);
        }

        const nodeCount = currentGraph.nodes.length;
        const edgeCount = currentGraph.edges.length;
        const folderInfo = selectedFolders.length > 0
          ? ` in ${selectedFolders.length} folder${selectedFolders.length > 1 ? 's' : ''}`
          : '';
        vscode.window.showInformationMessage(
          `CodeFlow: Found ${nodeCount} components with ${edgeCount} relationships${folderInfo}`
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

  // Send folder selection state when panel opens
  if (folderSelections.length > 0) {
    currentPanel.updateFolderSelection(folderSelections);
  } else {
    // Auto-discover folders if not already done
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      const rootPath = workspaceFolders[0].uri.fsPath;
      const config = vscode.workspace.getConfiguration('codeflow');
      const maxDepth = config.get<number>('maxDepth') || 5;
      folderSelections = await discoverFolders(rootPath, maxDepth);
      currentPanel.updateFolderSelection(folderSelections);
    }
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
async function toggleClaudeOrchestration(): Promise<void> {
  if (!claudeFlowMcp) {
    vscode.window.showErrorMessage('CodeFlow: Claude Flow not initialized');
    return;
  }

  const state = claudeFlowMcp.getState();

  if (!state.connected) {
    // Try to connect
    const connected = await claudeFlowMcp.initialize(vscode.extensions.getExtension('quxtech.codeflow')!.extensionPath as unknown as vscode.ExtensionContext);
    if (!connected) {
      vscode.window.showErrorMessage('CodeFlow: Could not connect to Claude Flow. Make sure claude-flow is installed (npm install -g claude-flow)');
      return;
    }
  }

  // Show options for orchestration
  const action = await vscode.window.showQuickPick([
    { label: '$(play) Start Edit Task', description: 'Edit selected components with Claude', value: 'start' },
    { label: '$(list-selection) Select Components', description: 'Choose components to edit', value: 'select' },
    { label: '$(sync) Sync Component Graph', description: 'Store graph in Claude Flow memory', value: 'sync' },
    { label: '$(stop) Cancel Current Task', description: 'Stop the running edit task', value: 'cancel' },
    { label: '$(info) Show Status', description: 'View Claude Flow connection status', value: 'status' }
  ], {
    placeHolder: 'Claude Flow Orchestration'
  });

  if (!action) return;

  switch (action.value) {
    case 'start':
      await startClaudeEditTask();
      break;
    case 'select':
      await showComponentSelector();
      break;
    case 'sync':
      await syncComponentGraph();
      break;
    case 'cancel':
      await claudeFlowMcp.cancelEditTask();
      break;
    case 'status':
      showClaudeFlowStatus();
      break;
  }
}

/**
 * Start a Claude edit task with selected components
 */
async function startClaudeEditTask(): Promise<void> {
  if (!currentGraph || !claudeFlowMcp) {
    vscode.window.showWarningMessage('CodeFlow: Generate a component map first');
    return;
  }

  if (selectedComponents.size === 0) {
    vscode.window.showWarningMessage('CodeFlow: Select components first (use the component list or Ctrl+Click nodes)');
    return;
  }

  // Get the selected nodes
  const nodes = currentGraph.nodes.filter(n => selectedComponents.has(n.id));

  // Ask for edit description
  const description = await vscode.window.showInputBox({
    prompt: 'Describe the edits you want Claude to make',
    placeHolder: 'e.g., Add error handling to all API calls'
  });

  if (!description) return;

  // Create the edit task
  const task = await claudeFlowMcp.createEditTask(nodes, description, currentGraph);

  if (task) {
    // Mark selected nodes as queued
    for (const node of nodes) {
      node.editStatus = 'queued';
    }
    updateVisualization();

    vscode.window.showInformationMessage(
      `CodeFlow: Started edit task for ${nodes.length} components`
    );
  }
}

/**
 * Show component selector quick pick
 */
async function showComponentSelector(): Promise<void> {
  if (!currentGraph) {
    vscode.window.showWarningMessage('CodeFlow: Generate a component map first');
    return;
  }

  const items = currentGraph.nodes.map(node => ({
    label: selectedComponents.has(node.id) ? `$(check) ${node.name}` : node.name,
    description: `${node.type} - ${node.filePath.split('/').pop()}`,
    detail: `Line ${node.line}`,
    node
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select components to edit (Space to toggle, Enter to confirm)'
  });

  if (selected) {
    selectedComponents.clear();
    for (const item of selected) {
      selectedComponents.add(item.node.id);
    }

    // Update visualization to show selection
    if (currentPanel) {
      currentPanel.updateSelectedComponents(Array.from(selectedComponents));
    }

    vscode.window.showInformationMessage(
      `CodeFlow: ${selectedComponents.size} components selected`
    );
  }
}

/**
 * Sync component graph to Claude Flow memory
 */
async function syncComponentGraph(): Promise<void> {
  if (!currentGraph || !claudeFlowMcp) {
    vscode.window.showWarningMessage('CodeFlow: Generate a component map first');
    return;
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const projectName = workspaceFolders?.[0]?.name || 'unknown';

  const success = await claudeFlowMcp.storeComponentGraph(currentGraph, projectName);

  if (success) {
    vscode.window.showInformationMessage(
      `CodeFlow: Synced ${currentGraph.nodes.length} components to Claude Flow memory`
    );
  } else {
    vscode.window.showErrorMessage('CodeFlow: Failed to sync component graph');
  }
}

/**
 * Show Claude Flow connection status
 */
function showClaudeFlowStatus(): void {
  if (!claudeFlowMcp) {
    vscode.window.showInformationMessage('CodeFlow: Claude Flow not initialized');
    return;
  }

  const state = claudeFlowMcp.getState();
  const task = claudeFlowMcp.getCurrentTask();

  let statusMessage = `Claude Flow: ${state.connected ? 'Connected' : 'Disconnected'}`;

  if (task) {
    statusMessage += `\nTask: ${task.description}`;
    statusMessage += `\nStatus: ${task.status}`;
    statusMessage += `\nProgress: ${task.progress}%`;
  }

  if (state.lastError) {
    statusMessage += `\nLast Error: ${state.lastError}`;
  }

  vscode.window.showInformationMessage(statusMessage);
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

    // Folder selection
    case 'toggleFolder':
      handleToggleFolder(message.payload as { path: string; selected: boolean });
      break;
    case 'selectAllFolders':
      handleSelectAllFolders(true);
      break;
    case 'deselectAllFolders':
      handleSelectAllFolders(false);
      break;
    case 'refreshFolders':
      handleRefreshFolders();
      break;
    case 'openFolderPicker':
      handleOpenFolderPicker();
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

  // Toggle selection
  if (selectedComponents.has(payload.nodeId)) {
    selectedComponents.delete(payload.nodeId);
    vscode.window.showInformationMessage(`CodeFlow: Deselected ${node.name}`);
  } else {
    selectedComponents.add(payload.nodeId);
    vscode.window.showInformationMessage(`CodeFlow: Selected ${node.name} (${selectedComponents.size} total)`);
  }

  // Update panel to show selection
  if (currentPanel) {
    currentPanel.updateSelectedComponents(Array.from(selectedComponents));
  }
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
 * Handle toggling a folder selection
 */
function handleToggleFolder(payload: { path: string; selected: boolean }): void {
  function toggleInTree(folders: FolderSelection[]): boolean {
    for (const folder of folders) {
      if (folder.path === payload.path) {
        folder.selected = payload.selected;
        // Also toggle all children
        if (folder.children) {
          setAllSelected(folder.children, payload.selected);
        }
        return true;
      }
      if (folder.children && toggleInTree(folder.children)) {
        return true;
      }
    }
    return false;
  }

  function setAllSelected(folders: FolderSelection[], selected: boolean): void {
    for (const folder of folders) {
      folder.selected = selected;
      if (folder.children) {
        setAllSelected(folder.children, selected);
      }
    }
  }

  toggleInTree(folderSelections);

  // Update panel with new selection state
  if (currentPanel) {
    currentPanel.updateFolderSelection(folderSelections);
  }
}

/**
 * Handle selecting or deselecting all folders
 */
function handleSelectAllFolders(selected: boolean): void {
  function setAllSelected(folders: FolderSelection[]): void {
    for (const folder of folders) {
      folder.selected = selected;
      if (folder.children) {
        setAllSelected(folder.children);
      }
    }
  }

  setAllSelected(folderSelections);

  // Update panel with new selection state
  if (currentPanel) {
    currentPanel.updateFolderSelection(folderSelections);
  }
}

/**
 * Handle refreshing the folder list
 */
async function handleRefreshFolders(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration('codeflow');
  const maxDepth = config.get<number>('maxDepth') || 5;

  // Re-discover folders
  folderSelections = await discoverFolders(rootPath, maxDepth);

  // Update panel with new folder list
  if (currentPanel) {
    currentPanel.updateFolderSelection(folderSelections);
  }
}

/**
 * Handle opening the folder picker dialog
 */
async function handleOpenFolderPicker(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  // Flatten the folder tree for quick pick
  function flattenFolders(folders: FolderSelection[], result: Array<{ label: string; description: string; folder: FolderSelection }> = []): Array<{ label: string; description: string; folder: FolderSelection }> {
    for (const folder of folders) {
      const indent = '  '.repeat(folder.depth);
      const checkmark = folder.selected ? '$(check)' : '$(circle-outline)';
      result.push({
        label: `${checkmark} ${indent}${folder.name}`,
        description: folder.path,
        folder
      });
      if (folder.children) {
        flattenFolders(folder.children, result);
      }
    }
    return result;
  }

  const items = flattenFolders(folderSelections);

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select folders to include in component map',
    title: 'CodeFlow: Select Folders'
  });

  if (selected) {
    // Deselect all first
    handleSelectAllFolders(false);

    // Select the chosen folders
    const selectedPaths = new Set(selected.map(s => s.folder.path));
    const markSelected = (folders: FolderSelection[]): void => {
      for (const folder of folders) {
        if (selectedPaths.has(folder.path)) {
          folder.selected = true;
        }
        if (folder.children) {
          markSelected(folder.children);
        }
      }
    };
    markSelected(folderSelections);

    // Update panel with new selection state
    if (currentPanel) {
      currentPanel.updateFolderSelection(folderSelections);
    }

    // Regenerate the component map with new selection
    const context = currentPanel?.getContext();
    if (context) {
      await generateComponentMap(context);
    }
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
  if (claudeFlowMcp) {
    claudeFlowMcp.dispose();
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
