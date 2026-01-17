import * as vscode from 'vscode';
import { ComponentGraph, EditPlan, WebviewMessage, ExtensionMessage } from '../types';

/**
 * Manages the CodeFlow visualization panel
 */
export class CodeFlowPanel {
  private panel: vscode.WebviewPanel;
  private context: vscode.ExtensionContext;
  private messageHandler: (message: WebviewMessage) => void;
  private currentGraph: ComponentGraph | null = null;

  constructor(
    context: vscode.ExtensionContext,
    messageHandler: (message: WebviewMessage) => void
  ) {
    this.context = context;
    this.messageHandler = messageHandler;

    this.panel = vscode.window.createWebviewPanel(
      'codeflowVisualizer',
      'CodeFlow: Component Map',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri]
      }
    );

    this.panel.webview.html = this.getWebviewContent();

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.messageHandler(message),
      undefined,
      context.subscriptions
    );

    // Handle panel disposal
    this.panel.onDidDispose(
      () => {
        // Panel was closed
      },
      undefined,
      context.subscriptions
    );
  }

  /**
   * Get the extension context
   */
  getContext(): vscode.ExtensionContext {
    return this.context;
  }

  /**
   * Reveal the panel
   */
  reveal(): void {
    this.panel.reveal();
  }

  /**
   * Dispose the panel
   */
  dispose(): void {
    this.panel.dispose();
  }

  /**
   * Update the graph visualization
   */
  updateGraph(graph: ComponentGraph, mermaidCode: string): void {
    this.currentGraph = graph;
    this.postMessage({
      type: 'graphUpdate',
      payload: { graph, mermaidCode }
    });
  }

  /**
   * Update the edit plan status
   */
  updateEditPlan(plan: EditPlan): void {
    this.postMessage({
      type: 'editPlanUpdate',
      payload: plan
    });
  }

  /**
   * Update the edit activity log
   */
  updateEditActivity(activity: Array<{ nodeName: string; timestamp: number; type: string }>): void {
    this.postMessage({
      type: 'activityUpdate',
      payload: activity
    });
  }

  /**
   * Update the auto-approve state in the webview
   */
  updateAutoApproveState(state: { 
    enabled: boolean; 
    approvedCount: number; 
    deniedCount: number;
    lastAction: { type: string; file?: string; timestamp: number } | null;
  }): void {
    this.postMessage({
      type: 'autoApproveUpdate',
      payload: state
    });
  }

  /**
   * Update undo history
   */
  updateUndoHistory(history: Array<{
    id: string;
    filePath: string;
    fileName: string;
    timestamp: number;
    canUndo: boolean;
  }>): void {
    this.postMessage({
      type: 'undoHistoryUpdate',
      payload: history
    });
  }

  /**
   * Update context files
   */
  updateContextFiles(files: Array<{
    filePath: string;
    fileName: string;
    relativePath: string;
    selected: boolean;
    tokenEstimate: number;
  }>): void {
    this.postMessage({
      type: 'contextFilesUpdate',
      payload: files
    });
  }

  /**
   * Update pending diffs
   */
  updatePendingDiffs(diffs: Array<{
    id: string;
    filePath: string;
    fileName: string;
    additions: number;
    deletions: number;
    timestamp: number;
  }>): void {
    this.postMessage({
      type: 'pendingDiffsUpdate',
      payload: diffs
    });
  }

  /**
   * Update session info
   */
  updateSessionInfo(
    actions: Array<{ id: string; type: string; description: string; timestamp: number }>,
    stats: { filesEdited: number; promptsSent: number; approvalsGiven: number; duration: number }
  ): void {
    this.postMessage({
      type: 'sessionInfoUpdate',
      payload: { actions, stats: { ...stats, sessionDuration: stats.duration } }
    });
  }

  /**
   * Update cost summary
   */
  updateCostSummary(summary: {
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }): void {
    this.postMessage({
      type: 'costSummaryUpdate',
      payload: summary
    });
  }

  /**
   * Update bookmarks
   */
  updateBookmarks(bookmarks: Array<{
    id: string;
    name: string;
    fileName: string;
    color: string;
    isPinned: boolean;
    note?: string;
  }>): void {
    this.postMessage({
      type: 'bookmarksUpdate',
      payload: bookmarks
    });
  }

  /**
   * Show an error
   */
  showError(message: string): void {
    this.postMessage({
      type: 'error',
      payload: { message }
    });
  }

  /**
   * Post a message to the webview
   */
  private postMessage(message: ExtensionMessage): void {
    this.panel.webview.postMessage(message);
  }

  /**
   * Generate the webview HTML content
   */
  private getWebviewContent(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; img-src data: https:;">
  <title>CodeFlow: Component Map</title>
  <style>
    :root {
      --bg-primary: var(--vscode-editor-background);
      --bg-secondary: var(--vscode-sideBar-background);
      --text-primary: var(--vscode-editor-foreground);
      --text-secondary: var(--vscode-descriptionForeground);
      --border-color: var(--vscode-panel-border);
      --accent-color: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    .toolbar button {
      padding: 6px 12px;
      background: var(--accent-color);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .toolbar button:hover {
      background: var(--accent-hover);
    }

    .toolbar button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .toolbar .spacer {
      flex: 1;
    }

    .toolbar .stats {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .main-container {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    .diagram-container {
      flex: 1;
      overflow: auto;
      padding: 16px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    #mermaid-diagram {
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 16px;
      min-width: 300px;
    }

    .sidebar {
      width: 280px;
      background: var(--bg-secondary);
      border-left: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar.hidden {
      display: none;
    }

    .sidebar-header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      font-weight: 600;
      font-size: 13px;
    }

    .sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .component-list {
      list-style: none;
    }

    .component-item {
      padding: 8px 12px;
      margin-bottom: 4px;
      background: var(--bg-primary);
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .component-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .component-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .component-type {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--accent-color);
      color: var(--vscode-button-foreground);
    }

    .component-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-idle { background: #6b7280; }
    .status-queued { background: #f59e0b; }
    .status-editing { background: #3b82f6; animation: pulse 1s infinite; }
    .status-completed { background: #10b981; }
    .status-error { background: #ef4444; }
    .status-skipped { background: #8b5cf6; }
    .status-manual { background: #ec4899; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .edit-plan-panel {
      padding: 12px;
      background: var(--vscode-inputValidation-infoBackground);
      border-top: 1px solid var(--border-color);
    }

    .edit-plan-panel.hidden {
      display: none;
    }

    .edit-plan-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .edit-plan-title {
      font-weight: 600;
      font-size: 12px;
    }

    .edit-plan-progress {
      height: 4px;
      background: var(--border-color);
      border-radius: 2px;
      overflow: hidden;
      margin-bottom: 8px;
    }

    .edit-plan-progress-bar {
      height: 100%;
      background: var(--accent-color);
      transition: width 0.3s ease;
    }

    .edit-plan-status {
      font-size: 11px;
      color: var(--text-secondary);
    }

    .activity-log {
      border-top: 1px solid var(--border-color);
      max-height: 150px;
      overflow-y: auto;
    }

    .activity-log-header {
      padding: 8px 12px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      background: var(--bg-secondary);
      position: sticky;
      top: 0;
    }

    .activity-item {
      padding: 6px 12px;
      font-size: 11px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--border-color);
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-icon {
      font-size: 12px;
    }

    .activity-icon.editing {
      animation: pulse 1s infinite;
    }

    .activity-name {
      flex: 1;
      font-weight: 500;
    }

    .activity-time {
      color: var(--text-secondary);
      font-size: 10px;
    }

    .activity-item.editing {
      background: rgba(59, 130, 246, 0.1);
    }

    .activity-item.complete {
      background: rgba(16, 185, 129, 0.1);
    }

    .auto-approve-panel {
      padding: 12px;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
    }

    .auto-approve-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .auto-approve-title {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .auto-approve-toggle {
      position: relative;
      width: 44px;
      height: 22px;
      background: var(--border-color);
      border-radius: 11px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .auto-approve-toggle.enabled {
      background: #10b981;
    }

    .auto-approve-toggle::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 18px;
      height: 18px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }

    .auto-approve-toggle.enabled::after {
      transform: translateX(22px);
    }

    .auto-approve-status {
      font-size: 10px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }

    .auto-approve-status.enabled {
      color: #10b981;
    }

    .approval-buttons {
      display: flex;
      gap: 8px;
    }

    .approval-btn {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: all 0.2s;
    }

    .approval-btn.yes {
      background: #10b981;
      color: white;
    }

    .approval-btn.yes:hover {
      background: #059669;
    }

    .approval-btn.no {
      background: #ef4444;
      color: white;
    }

    .approval-btn.no:hover {
      background: #dc2626;
    }

    .approval-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .approval-stats {
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--text-secondary);
      margin-top: 8px;
    }

    .approval-stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .approval-stat.approved {
      color: #10b981;
    }

    .approval-stat.denied {
      color: #ef4444;
    }

    .shortcut-hint {
      font-size: 9px;
      color: var(--text-secondary);
      text-align: center;
      margin-top: 6px;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent-color);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      gap: 16px;
      color: var(--text-secondary);
      text-align: center;
      padding: 32px;
    }

    .empty-state h2 {
      color: var(--text-primary);
      font-size: 18px;
    }

    .empty-state p {
      font-size: 13px;
      max-width: 400px;
    }

    .error-message {
      padding: 12px 16px;
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      border-radius: 4px;
      margin: 16px;
      font-size: 12px;
    }

    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      padding: 8px 16px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      font-size: 11px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 2px;
    }

    /* Feature panels */
    .feature-panel {
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .feature-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
    }

    .feature-panel-header:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .feature-panel-content {
      padding: 8px 12px;
      max-height: 150px;
      overflow-y: auto;
    }

    .feature-panel-content.collapsed {
      display: none;
    }

    .feature-list {
      list-style: none;
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      margin-bottom: 4px;
      background: var(--bg-primary);
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    .feature-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .feature-item-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .feature-item-meta {
      font-size: 10px;
      color: var(--text-secondary);
    }

    .feature-item-actions {
      display: flex;
      gap: 4px;
    }

    .feature-item-btn {
      padding: 2px 6px;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 10px;
      background: var(--accent-color);
      color: var(--vscode-button-foreground);
    }

    .feature-item-btn:hover {
      background: var(--accent-hover);
    }

    .feature-item-btn.danger {
      background: #ef4444;
    }

    .feature-item-btn.danger:hover {
      background: #dc2626;
    }

    /* Undo panel */
    .undo-item {
      border-left: 3px solid #f59e0b;
    }

    /* Context panel */
    .context-item {
      border-left: 3px solid #3b82f6;
    }

    .context-summary {
      display: flex;
      justify-content: space-between;
      padding: 6px 8px;
      font-size: 10px;
      color: var(--text-secondary);
      border-top: 1px solid var(--border-color);
    }

    .context-actions {
      display: flex;
      gap: 8px;
      padding: 8px;
    }

    .context-actions button {
      flex: 1;
    }

    /* Diff panel */
    .diff-item {
      border-left: 3px solid #10b981;
    }

    .diff-stats {
      display: flex;
      gap: 8px;
      font-size: 10px;
    }

    .diff-add {
      color: #10b981;
    }

    .diff-del {
      color: #ef4444;
    }

    /* Bookmarks panel */
    .bookmark-item {
      position: relative;
    }

    .bookmark-color {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .bookmark-pin {
      position: absolute;
      top: 2px;
      right: 2px;
      font-size: 10px;
    }

    /* Prompt templates */
    .template-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px;
    }

    .template-btn {
      padding: 8px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--bg-primary);
      cursor: pointer;
      text-align: left;
      font-size: 10px;
    }

    .template-btn:hover {
      background: var(--vscode-list-hoverBackground);
      border-color: var(--accent-color);
    }

    .template-icon {
      font-size: 14px;
      margin-bottom: 4px;
    }

    .template-name {
      font-weight: 500;
    }

    /* Session stats */
    .session-stats {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      padding: 8px;
    }

    .stat-box {
      background: var(--bg-primary);
      padding: 8px;
      border-radius: 4px;
      text-align: center;
    }

    .stat-value {
      font-size: 18px;
      font-weight: 600;
    }

    .stat-label {
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* Cost display */
    .cost-display {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-primary);
      border-radius: 4px;
      margin: 8px;
    }

    .cost-amount {
      font-size: 16px;
      font-weight: 600;
    }

    .cost-details {
      font-size: 10px;
      color: var(--text-secondary);
    }

    /* Tab navigation for sidebar */
    .sidebar-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      background: var(--bg-secondary);
    }

    .sidebar-tab {
      flex: 1;
      padding: 8px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 14px;
      opacity: 0.6;
      border-bottom: 2px solid transparent;
    }

    .sidebar-tab:hover {
      opacity: 0.8;
    }

    .sidebar-tab.active {
      opacity: 1;
      border-bottom-color: var(--accent-color);
    }

    .sidebar-tab-content {
      display: none;
    }

    .sidebar-tab-content.active {
      display: block;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="refresh-btn" title="Refresh">
      🔄 Refresh
    </button>
    <button id="zoom-in-btn" title="Zoom In">➕</button>
    <button id="zoom-out-btn" title="Zoom Out">➖</button>
    <button id="fit-btn" title="Fit to View">⬜</button>
    <div class="spacer"></div>
    <div class="stats" id="stats">No components loaded</div>
    <button id="toggle-sidebar-btn" title="Toggle Sidebar">📋</button>
  </div>

  <div class="main-container">
    <div class="diagram-container" id="diagram-container">
      <div class="empty-state" id="empty-state">
        <h2>No Component Map</h2>
        <p>Click "Refresh" or run the command "CodeFlow: Generate Component Map" to scan your project.</p>
      </div>
      <div class="loading hidden" id="loading">
        <div class="loading-spinner"></div>
        <div>Generating component map...</div>
      </div>
      <div id="mermaid-diagram" class="hidden"></div>
    </div>

    <div class="sidebar" id="sidebar">
      <!-- Sidebar Tabs -->
      <div class="sidebar-tabs">
        <button class="sidebar-tab active" data-tab="main" title="Main">🎯</button>
        <button class="sidebar-tab" data-tab="tools" title="Tools">🛠️</button>
        <button class="sidebar-tab" data-tab="context" title="Context">📎</button>
        <button class="sidebar-tab" data-tab="history" title="History">📜</button>
      </div>

      <!-- Main Tab -->
      <div class="sidebar-tab-content active" id="tab-main">
        <!-- Auto-approve Panel -->
        <div class="auto-approve-panel" id="auto-approve-panel">
          <div class="auto-approve-header">
            <span class="auto-approve-title">🤖 Auto-Approve</span>
            <div class="auto-approve-toggle" id="auto-approve-toggle" title="Toggle auto-approve"></div>
          </div>
          <div class="auto-approve-status" id="auto-approve-status">Manual mode</div>
          <div class="approval-buttons">
            <button class="approval-btn yes" id="approve-btn" title="Ctrl+Shift+Y">✓ Yes</button>
            <button class="approval-btn no" id="deny-btn" title="Ctrl+Shift+N">✗ No</button>
          </div>
          <div class="approval-stats">
            <span class="approval-stat approved" id="approved-count">✓ 0</span>
            <span class="approval-stat denied" id="denied-count">✗ 0</span>
          </div>
        </div>

        <!-- Components List -->
        <div class="sidebar-header">Components</div>
        <div class="sidebar-content">
          <ul class="component-list" id="component-list"></ul>
        </div>

        <!-- Live Activity -->
        <div class="activity-log" id="activity-log">
          <div class="activity-log-header">📝 Live Activity</div>
          <div id="activity-list">
            <div class="activity-item" style="color: var(--text-secondary); font-style: italic;">
              Waiting for edits...
            </div>
          </div>
        </div>
      </div>

      <!-- Tools Tab -->
      <div class="sidebar-tab-content" id="tab-tools">
        <!-- Quick Actions -->
        <div class="feature-panel">
          <div class="feature-panel-header" data-panel="templates">
            ⚡ Quick Actions
            <span>▼</span>
          </div>
          <div class="feature-panel-content" id="templates-content">
            <div class="template-grid" id="template-grid">
              <button class="template-btn" data-template="add-error-handling">
                <div class="template-icon">🛡️</div>
                <div class="template-name">Error Handling</div>
              </button>
              <button class="template-btn" data-template="add-typescript-types">
                <div class="template-icon">📝</div>
                <div class="template-name">Add Types</div>
              </button>
              <button class="template-btn" data-template="write-unit-tests">
                <div class="template-icon">🧪</div>
                <div class="template-name">Write Tests</div>
              </button>
              <button class="template-btn" data-template="add-jsdoc">
                <div class="template-icon">📚</div>
                <div class="template-name">Add Docs</div>
              </button>
              <button class="template-btn" data-template="find-bugs">
                <div class="template-icon">🐛</div>
                <div class="template-name">Find Bugs</div>
              </button>
              <button class="template-btn" data-template="refactor-performance">
                <div class="template-icon">⚡</div>
                <div class="template-name">Optimize</div>
              </button>
            </div>
            <button class="feature-item-btn" style="width: 100%; margin-top: 8px;" id="show-all-templates">
              Show All Templates...
            </button>
          </div>
        </div>

        <!-- Pending Diffs -->
        <div class="feature-panel">
          <div class="feature-panel-header" data-panel="diffs">
            🔄 Pending Changes
            <span id="diff-count">(0)</span>
          </div>
          <div class="feature-panel-content" id="diffs-content">
            <ul class="feature-list" id="diff-list">
              <li class="feature-item" style="color: var(--text-secondary); font-style: italic;">
                No pending changes
              </li>
            </ul>
          </div>
        </div>

        <!-- Undo History -->
        <div class="feature-panel">
          <div class="feature-panel-header" data-panel="undo">
            ↩️ Undo History
            <span id="undo-count">(0)</span>
          </div>
          <div class="feature-panel-content" id="undo-content">
            <ul class="feature-list" id="undo-list">
              <li class="feature-item" style="color: var(--text-secondary); font-style: italic;">
                No recent edits
              </li>
            </ul>
            <button class="feature-item-btn danger" style="width: 100%; margin-top: 8px;" id="rollback-all">
              Rollback All Session Changes
            </button>
          </div>
        </div>

        <!-- Bookmarks -->
        <div class="feature-panel">
          <div class="feature-panel-header" data-panel="bookmarks">
            🔖 Bookmarks
            <span id="bookmark-count">(0)</span>
          </div>
          <div class="feature-panel-content" id="bookmarks-content">
            <ul class="feature-list" id="bookmark-list">
              <li class="feature-item" style="color: var(--text-secondary); font-style: italic;">
                No bookmarks yet
              </li>
            </ul>
            <button class="feature-item-btn" style="width: 100%; margin-top: 8px;" id="add-bookmark">
              + Add Bookmark
            </button>
          </div>
        </div>
      </div>

      <!-- Context Tab -->
      <div class="sidebar-tab-content" id="tab-context">
        <div class="feature-panel">
          <div class="feature-panel-header">
            📎 Context Files
          </div>
          <div class="feature-panel-content">
            <ul class="feature-list" id="context-list">
              <li class="feature-item" style="color: var(--text-secondary); font-style: italic;">
                Click components to add to context
              </li>
            </ul>
          </div>
          <div class="context-summary" id="context-summary">
            <span>0 files</span>
            <span>~0 tokens</span>
          </div>
          <div class="context-actions">
            <button class="feature-item-btn" id="copy-context-refs">Copy @refs</button>
            <button class="feature-item-btn" id="copy-context-content">Copy Content</button>
            <button class="feature-item-btn danger" id="clear-context">Clear</button>
          </div>
        </div>

        <div class="feature-panel">
          <div class="feature-panel-header">
            💡 Tip
          </div>
          <div class="feature-panel-content">
            <p style="font-size: 11px; color: var(--text-secondary);">
              Select components from the diagram to add them to Claude's context. 
              Use "Copy @refs" for Claude CLI or "Copy Content" to paste directly.
            </p>
          </div>
        </div>
      </div>

      <!-- History Tab -->
      <div class="sidebar-tab-content" id="tab-history">
        <!-- Session Stats -->
        <div class="session-stats" id="session-stats">
          <div class="stat-box">
            <div class="stat-value" id="stat-files">0</div>
            <div class="stat-label">Files Edited</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="stat-prompts">0</div>
            <div class="stat-label">Prompts</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="stat-approvals">0</div>
            <div class="stat-label">Approvals</div>
          </div>
          <div class="stat-box">
            <div class="stat-value" id="stat-duration">0m</div>
            <div class="stat-label">Duration</div>
          </div>
        </div>

        <!-- Cost Display -->
        <div class="cost-display">
          <div>
            <div class="cost-amount" id="cost-amount">$0.00</div>
            <div class="cost-details" id="cost-details">~0 tokens</div>
          </div>
          <button class="feature-item-btn" id="cost-details-btn">Details</button>
        </div>

        <!-- Action History -->
        <div class="feature-panel">
          <div class="feature-panel-header">
            📋 Action Log
          </div>
          <div class="feature-panel-content" style="max-height: 200px;">
            <ul class="feature-list" id="action-log">
              <li class="feature-item" style="color: var(--text-secondary); font-style: italic;">
                Session started
              </li>
            </ul>
          </div>
        </div>

        <div style="padding: 8px;">
          <button class="feature-item-btn" style="width: 100%;" id="export-session">
            📥 Export Session Log
          </button>
        </div>
      </div>

      <!-- Edit Plan Panel (overlay) -->
      <div class="edit-plan-panel hidden" id="edit-plan-panel">
        <div class="edit-plan-header">
          <span class="edit-plan-title">Edit Plan</span>
          <button id="cancel-plan-btn" style="padding: 2px 8px; font-size: 10px;">Cancel</button>
        </div>
        <div class="edit-plan-progress">
          <div class="edit-plan-progress-bar" id="edit-plan-progress-bar" style="width: 0%"></div>
        </div>
        <div class="edit-plan-status" id="edit-plan-status">Waiting...</div>
      </div>
    </div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-color" style="background: #61dafb"></div> Component</div>
    <div class="legend-item"><div class="legend-color" style="background: #68d391"></div> Service</div>
    <div class="legend-item"><div class="legend-color" style="background: #f6ad55"></div> Hook</div>
    <div class="legend-item"><div class="legend-color" style="background: #b794f4"></div> Context/Store</div>
    <div class="legend-item"><div class="legend-color" style="background: #fc8181"></div> API</div>
    <div class="legend-item"><div class="legend-color" style="background: #90cdf4"></div> Utility</div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    
    // State
    let currentGraph = null;
    let selectedNodeId = null;
    let zoomLevel = 1;

    // Elements
    const diagramContainer = document.getElementById('diagram-container');
    const mermaidDiagram = document.getElementById('mermaid-diagram');
    const emptyState = document.getElementById('empty-state');
    const loading = document.getElementById('loading');
    const componentList = document.getElementById('component-list');
    const stats = document.getElementById('stats');
    const sidebar = document.getElementById('sidebar');
    const editPlanPanel = document.getElementById('edit-plan-panel');
    const editPlanProgressBar = document.getElementById('edit-plan-progress-bar');
    const editPlanStatus = document.getElementById('edit-plan-status');

    // Initialize Mermaid
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });

    // Event listeners
    document.getElementById('refresh-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'requestRefresh' });
      showLoading();
    });

    document.getElementById('zoom-in-btn').addEventListener('click', () => {
      zoomLevel = Math.min(zoomLevel * 1.2, 3);
      applyZoom();
    });

    document.getElementById('zoom-out-btn').addEventListener('click', () => {
      zoomLevel = Math.max(zoomLevel / 1.2, 0.3);
      applyZoom();
    });

    document.getElementById('fit-btn').addEventListener('click', () => {
      zoomLevel = 1;
      applyZoom();
    });

    document.getElementById('toggle-sidebar-btn').addEventListener('click', () => {
      sidebar.classList.toggle('hidden');
    });

    document.getElementById('cancel-plan-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'cancelPlan' });
    });

    // Auto-approve controls
    document.getElementById('auto-approve-toggle').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleAutoApprove' });
    });

    document.getElementById('approve-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'approveEdit' });
    });

    document.getElementById('deny-btn').addEventListener('click', () => {
      vscode.postMessage({ type: 'denyEdit' });
    });

    // Sidebar tab navigation
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        
        // Update tab buttons
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.sidebar-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + tabId)?.classList.add('active');
      });
    });

    // Feature panel collapsing
    document.querySelectorAll('.feature-panel-header').forEach(header => {
      header.addEventListener('click', () => {
        const panel = header.dataset.panel;
        if (panel) {
          const content = document.getElementById(panel + '-content');
          content?.classList.toggle('collapsed');
          header.querySelector('span').textContent = content?.classList.contains('collapsed') ? '▶' : '▼';
        }
      });
    });

    // Prompt template buttons
    document.querySelectorAll('.template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const templateId = btn.dataset.template;
        vscode.postMessage({ type: 'runPromptTemplate', payload: { templateId } });
      });
    });

    document.getElementById('show-all-templates')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'showPromptTemplates' });
    });

    // Undo/rollback
    document.getElementById('rollback-all')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'rollbackSession' });
    });

    // Bookmarks
    document.getElementById('add-bookmark')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'addBookmark', payload: {} });
    });

    // Context actions
    document.getElementById('copy-context-refs')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyContextReferences' });
    });

    document.getElementById('copy-context-content')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyContextContent' });
    });

    document.getElementById('clear-context')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'clearContext' });
    });

    // Cost/Session
    document.getElementById('cost-details-btn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'showCostSummary' });
    });

    document.getElementById('export-session')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'exportSessionLog' });
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      
      switch (message.type) {
        case 'graphUpdate':
          handleGraphUpdate(message.payload);
          break;
        case 'editPlanUpdate':
          handleEditPlanUpdate(message.payload);
          break;
        case 'activityUpdate':
          handleActivityUpdate(message.payload);
          break;
        case 'autoApproveUpdate':
          handleAutoApproveUpdate(message.payload);
          break;
        case 'undoHistoryUpdate':
          handleUndoHistoryUpdate(message.payload);
          break;
        case 'contextFilesUpdate':
          handleContextFilesUpdate(message.payload);
          break;
        case 'pendingDiffsUpdate':
          handlePendingDiffsUpdate(message.payload);
          break;
        case 'sessionInfoUpdate':
          handleSessionInfoUpdate(message.payload);
          break;
        case 'costSummaryUpdate':
          handleCostSummaryUpdate(message.payload);
          break;
        case 'bookmarksUpdate':
          handleBookmarksUpdate(message.payload);
          break;
        case 'error':
          showError(message.payload.message);
          break;
      }
    });

    function handleGraphUpdate(payload) {
      currentGraph = payload.graph;
      const mermaidCode = payload.mermaidCode;

      hideLoading();
      emptyState.classList.add('hidden');
      mermaidDiagram.classList.remove('hidden');

      // Update stats
      stats.textContent = currentGraph.nodes.length + ' components, ' + currentGraph.edges.length + ' relationships';

      // Render Mermaid diagram
      renderMermaid(mermaidCode);

      // Update component list
      renderComponentList();
    }

    async function renderMermaid(code) {
      try {
        const { svg } = await mermaid.render('mermaid-svg', code);
        mermaidDiagram.innerHTML = svg;

        // Add click handlers to nodes
        const svgElement = mermaidDiagram.querySelector('svg');
        if (svgElement) {
          svgElement.querySelectorAll('.node').forEach(node => {
            node.style.cursor = 'pointer';
            node.addEventListener('click', (e) => {
              const nodeId = node.id.replace('flowchart-', '').split('-')[0];
              handleNodeClick(nodeId);
            });
          });
        }

        applyZoom();
      } catch (error) {
        console.error('Mermaid render error:', error);
        mermaidDiagram.innerHTML = '<div class="error-message">Failed to render diagram: ' + error.message + '</div>';
      }
    }

    function renderComponentList() {
      if (!currentGraph) return;

      componentList.innerHTML = '';

      // Group by type
      const byType = {};
      currentGraph.nodes.forEach(node => {
        if (!byType[node.type]) byType[node.type] = [];
        byType[node.type].push(node);
      });

      // Sort types
      const typeOrder = ['component', 'service', 'hook', 'context', 'store', 'api', 'util', 'class', 'function', 'type', 'config', 'unknown'];
      
      typeOrder.forEach(type => {
        const nodes = byType[type];
        if (!nodes || nodes.length === 0) return;

        nodes.sort((a, b) => a.name.localeCompare(b.name));

        nodes.forEach(node => {
          const li = document.createElement('li');
          li.className = 'component-item' + (node.id === selectedNodeId ? ' selected' : '');
          li.innerHTML = 
            '<div class="status-indicator status-' + node.editStatus + '"></div>' +
            '<span class="component-type">' + node.type + '</span>' +
            '<span class="component-name" title="' + node.filePath + '">' + node.name + '</span>';
          
          li.addEventListener('click', () => handleNodeClick(node.id));
          li.addEventListener('dblclick', () => {
            vscode.postMessage({ type: 'nodeClick', payload: { nodeId: node.id } });
          });

          componentList.appendChild(li);
        });
      });
    }

    function handleNodeClick(nodeId) {
      // Find the actual node ID (might be sanitized)
      const node = currentGraph?.nodes.find(n => 
        n.id === nodeId || 
        n.id.replace(/[^a-zA-Z0-9_]/g, '_') === nodeId ||
        nodeId.startsWith(n.name)
      );

      if (node) {
        selectedNodeId = node.id;
        vscode.postMessage({ type: 'nodeClick', payload: { nodeId: node.id } });
        renderComponentList();
      }
    }

    function handleEditPlanUpdate(plan) {
      if (!plan || plan.status === 'cancelled') {
        editPlanPanel.classList.add('hidden');
        return;
      }

      editPlanPanel.classList.remove('hidden');

      const progress = plan.componentOrder.length > 0 
        ? (plan.currentIndex / plan.componentOrder.length) * 100 
        : 0;

      editPlanProgressBar.style.width = progress + '%';
      editPlanStatus.textContent = plan.description + ' (' + plan.currentIndex + '/' + plan.componentOrder.length + ')';
    }

    function showLoading() {
      emptyState.classList.add('hidden');
      mermaidDiagram.classList.add('hidden');
      loading.classList.remove('hidden');
    }

    function hideLoading() {
      loading.classList.add('hidden');
    }

    function showError(message) {
      hideLoading();
      mermaidDiagram.innerHTML = '<div class="error-message">' + message + '</div>';
      mermaidDiagram.classList.remove('hidden');
    }

    function applyZoom() {
      const svg = mermaidDiagram.querySelector('svg');
      if (svg) {
        svg.style.transform = 'scale(' + zoomLevel + ')';
        svg.style.transformOrigin = 'top center';
      }
    }

    function handleActivityUpdate(activity) {
      const activityList = document.getElementById('activity-list');
      if (!activityList || !activity || activity.length === 0) return;

      activityList.innerHTML = '';

      activity.forEach(item => {
        const div = document.createElement('div');
        div.className = 'activity-item ' + (item.type === 'start' ? 'editing' : 'complete');
        
        const icon = item.type === 'start' ? '✏️' : '✅';
        const iconClass = item.type === 'start' ? 'editing' : '';
        const action = item.type === 'start' ? 'Editing' : 'Completed';
        
        div.innerHTML = 
          '<span class="activity-icon ' + iconClass + '">' + icon + '</span>' +
          '<span class="activity-name">' + item.nodeName + '</span>' +
          '<span class="activity-time">' + formatTime(item.timestamp) + '</span>';
        
        activityList.appendChild(div);
      });

      // Flash effect on new activity
      activityList.firstChild?.classList.add('flash');
      setTimeout(() => {
        activityList.firstChild?.classList.remove('flash');
      }, 500);
    }

    function handleAutoApproveUpdate(state) {
      const toggle = document.getElementById('auto-approve-toggle');
      const status = document.getElementById('auto-approve-status');
      const approvedCount = document.getElementById('approved-count');
      const deniedCount = document.getElementById('denied-count');
      const approveBtn = document.getElementById('approve-btn');
      const denyBtn = document.getElementById('deny-btn');

      if (!toggle || !status) return;

      // Update toggle state
      if (state.enabled) {
        toggle.classList.add('enabled');
        status.textContent = '🟢 Auto-approve ON - All edits auto-accepted';
        status.classList.add('enabled');
        approveBtn.disabled = true;
        denyBtn.disabled = true;
      } else {
        toggle.classList.remove('enabled');
        status.textContent = 'Manual mode - Click Yes/No for each edit';
        status.classList.remove('enabled');
        approveBtn.disabled = false;
        denyBtn.disabled = false;
      }

      // Update counts
      if (approvedCount) {
        approvedCount.textContent = '✓ ' + state.approvedCount + ' approved';
      }
      if (deniedCount) {
        deniedCount.textContent = '✗ ' + state.deniedCount + ' denied';
      }

      // Flash last action
      if (state.lastAction && Date.now() - state.lastAction.timestamp < 2000) {
        const btn = state.lastAction.type === 'approve' ? approveBtn : denyBtn;
        if (btn) {
          btn.style.transform = 'scale(1.1)';
          setTimeout(() => {
            btn.style.transform = 'scale(1)';
          }, 200);
        }
      }
    }

    function formatTime(timestamp) {
      const now = Date.now();
      const diff = now - timestamp;
      
      if (diff < 1000) return 'just now';
      if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      
      return new Date(timestamp).toLocaleTimeString();
    }

    // Update activity times periodically
    setInterval(() => {
      const activityList = document.getElementById('activity-list');
      if (activityList) {
        activityList.querySelectorAll('.activity-time').forEach(el => {
          // Times will auto-update on next activity push
        });
      }
    }, 10000);

    // Handler functions for new features
    function handleUndoHistoryUpdate(history) {
      const undoList = document.getElementById('undo-list');
      const undoCount = document.getElementById('undo-count');
      
      if (!undoList) return;
      
      const undoable = history.filter(h => h.canUndo);
      undoCount.textContent = '(' + undoable.length + ')';
      
      if (undoable.length === 0) {
        undoList.innerHTML = '<li class="feature-item" style="color: var(--text-secondary); font-style: italic;">No recent edits</li>';
        return;
      }
      
      undoList.innerHTML = '';
      undoable.slice(0, 10).forEach(item => {
        const li = document.createElement('li');
        li.className = 'feature-item undo-item';
        li.innerHTML = 
          '<span class="feature-item-name">' + item.fileName + '</span>' +
          '<span class="feature-item-meta">' + formatTime(item.timestamp) + '</span>' +
          '<button class="feature-item-btn" onclick="undoFile(\'' + item.filePath.replace(/'/g, "\\'") + '\')">Undo</button>';
        undoList.appendChild(li);
      });
    }

    function undoFile(filePath) {
      vscode.postMessage({ type: 'undoFile', payload: { filePath } });
    }

    function handleContextFilesUpdate(files) {
      const contextList = document.getElementById('context-list');
      const contextSummary = document.getElementById('context-summary');
      
      if (!contextList) return;
      
      if (files.length === 0) {
        contextList.innerHTML = '<li class="feature-item" style="color: var(--text-secondary); font-style: italic;">Click components to add to context</li>';
        contextSummary.innerHTML = '<span>0 files</span><span>~0 tokens</span>';
        return;
      }
      
      const totalTokens = files.reduce((sum, f) => sum + f.tokenEstimate, 0);
      contextSummary.innerHTML = '<span>' + files.length + ' files</span><span>~' + Math.round(totalTokens / 1000) + 'k tokens</span>';
      
      contextList.innerHTML = '';
      files.forEach(file => {
        const li = document.createElement('li');
        li.className = 'feature-item context-item';
        li.innerHTML = 
          '<span class="feature-item-name" title="' + file.relativePath + '">' + file.fileName + '</span>' +
          '<span class="feature-item-meta">~' + Math.round(file.tokenEstimate / 100) / 10 + 'k</span>' +
          '<button class="feature-item-btn danger" onclick="removeFromContext(\'' + file.filePath.replace(/'/g, "\\'") + '\')">✕</button>';
        contextList.appendChild(li);
      });
    }

    function removeFromContext(filePath) {
      vscode.postMessage({ type: 'removeFromContext', payload: { filePath } });
    }

    function handlePendingDiffsUpdate(diffs) {
      const diffList = document.getElementById('diff-list');
      const diffCount = document.getElementById('diff-count');
      
      if (!diffList) return;
      
      diffCount.textContent = '(' + diffs.length + ')';
      
      if (diffs.length === 0) {
        diffList.innerHTML = '<li class="feature-item" style="color: var(--text-secondary); font-style: italic;">No pending changes</li>';
        return;
      }
      
      diffList.innerHTML = '';
      diffs.forEach(diff => {
        const li = document.createElement('li');
        li.className = 'feature-item diff-item';
        li.innerHTML = 
          '<span class="feature-item-name">' + diff.fileName + '</span>' +
          '<div class="diff-stats">' +
            '<span class="diff-add">+' + diff.additions + '</span>' +
            '<span class="diff-del">-' + diff.deletions + '</span>' +
          '</div>' +
          '<div class="feature-item-actions">' +
            '<button class="feature-item-btn" onclick="showDiff(\'' + diff.filePath.replace(/'/g, "\\'") + '\')">View</button>' +
            '<button class="feature-item-btn" onclick="approveDiff(\'' + diff.id + '\')">✓</button>' +
            '<button class="feature-item-btn danger" onclick="denyDiff(\'' + diff.id + '\')">✕</button>' +
          '</div>';
        diffList.appendChild(li);
      });
    }

    function showDiff(filePath) {
      vscode.postMessage({ type: 'showDiff', payload: { filePath } });
    }

    function approveDiff(diffId) {
      vscode.postMessage({ type: 'approveDiff', payload: { diffId } });
    }

    function denyDiff(diffId) {
      vscode.postMessage({ type: 'denyDiff', payload: { diffId } });
    }

    function handleSessionInfoUpdate(data) {
      const { actions, stats } = data;
      
      // Update stats
      document.getElementById('stat-files').textContent = stats.filesEdited || 0;
      document.getElementById('stat-prompts').textContent = stats.promptsSent || 0;
      document.getElementById('stat-approvals').textContent = stats.approvalsGiven || 0;
      
      const duration = stats.sessionDuration || 0;
      const minutes = Math.floor(duration / 60000);
      document.getElementById('stat-duration').textContent = minutes + 'm';
      
      // Update action log
      const actionLog = document.getElementById('action-log');
      if (!actionLog || !actions) return;
      
      actionLog.innerHTML = '';
      actions.slice(0, 20).forEach(action => {
        const li = document.createElement('li');
        li.className = 'feature-item';
        li.innerHTML = 
          '<span class="feature-item-name">' + action.description + '</span>' +
          '<span class="feature-item-meta">' + formatTime(action.timestamp) + '</span>';
        actionLog.appendChild(li);
      });
    }

    function handleCostSummaryUpdate(summary) {
      document.getElementById('cost-amount').textContent = '$' + summary.totalCost.toFixed(2);
      document.getElementById('cost-details').textContent = '~' + Math.round(summary.totalTokens / 1000) + 'k tokens';
    }

    function handleBookmarksUpdate(bookmarks) {
      const bookmarkList = document.getElementById('bookmark-list');
      const bookmarkCount = document.getElementById('bookmark-count');
      
      if (!bookmarkList) return;
      
      bookmarkCount.textContent = '(' + bookmarks.length + ')';
      
      if (bookmarks.length === 0) {
        bookmarkList.innerHTML = '<li class="feature-item" style="color: var(--text-secondary); font-style: italic;">No bookmarks yet</li>';
        return;
      }
      
      bookmarkList.innerHTML = '';
      bookmarks.forEach(bookmark => {
        const li = document.createElement('li');
        li.className = 'feature-item bookmark-item';
        li.innerHTML = 
          '<div class="bookmark-color" style="background: ' + getBookmarkColor(bookmark.color) + '"></div>' +
          (bookmark.isPinned ? '<span class="bookmark-pin">📌</span>' : '') +
          '<span class="feature-item-name" title="' + (bookmark.note || '') + '">' + bookmark.name + '</span>' +
          '<span class="feature-item-meta">' + bookmark.fileName + '</span>' +
          '<div class="feature-item-actions">' +
            '<button class="feature-item-btn" onclick="goToBookmark(\'' + bookmark.id + '\')">Go</button>' +
            '<button class="feature-item-btn danger" onclick="removeBookmark(\'' + bookmark.id + '\')">✕</button>' +
          '</div>';
        li.addEventListener('dblclick', () => goToBookmark(bookmark.id));
        bookmarkList.appendChild(li);
      });
    }

    function getBookmarkColor(color) {
      const colors = {
        red: '#ef4444',
        orange: '#f97316',
        yellow: '#eab308',
        green: '#22c55e',
        blue: '#3b82f6',
        purple: '#a855f7',
        pink: '#ec4899'
      };
      return colors[color] || colors.blue;
    }

    function goToBookmark(bookmarkId) {
      vscode.postMessage({ type: 'goToBookmark', payload: { bookmarkId } });
    }

    function removeBookmark(bookmarkId) {
      vscode.postMessage({ type: 'removeBookmark', payload: { bookmarkId } });
    }
  </script>
</body>
</html>`;
  }
}

/**
 * Generate a random nonce for CSP
 */
function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
