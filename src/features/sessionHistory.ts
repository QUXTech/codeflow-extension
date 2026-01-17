import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Session action types
 */
export type SessionActionType = 
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'prompt_sent'
  | 'approval'
  | 'denial'
  | 'undo'
  | 'context_change'
  | 'component_select';

/**
 * Session action entry
 */
export interface SessionAction {
  id: string;
  type: SessionActionType;
  timestamp: number;
  description: string;
  details?: {
    filePath?: string;
    fileName?: string;
    componentName?: string;
    promptTemplate?: string;
    tokenCount?: number;
    [key: string]: any;
  };
  canRepeat: boolean;
  repeatCommand?: string;
}

/**
 * Session summary statistics
 */
export interface SessionStats {
  startTime: number;
  duration: number;
  filesEdited: number;
  filesCreated: number;
  promptsSent: number;
  approvalsGiven: number;
  denialsGiven: number;
  undosPerformed: number;
  estimatedTokensUsed: number;
}

/**
 * Session History Manager
 * 
 * Tracks all actions in the current session for reference and repeat.
 */
export class SessionHistoryManager {
  private actions: SessionAction[] = [];
  private sessionStartTime: number = Date.now();
  private stateCallbacks: ((actions: SessionAction[], stats: SessionStats) => void)[] = [];
  private filesEdited: Set<string> = new Set();
  private filesCreated: Set<string> = new Set();
  private estimatedTokens: number = 0;

  constructor() {}

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.showSessionHistory', () =>
        this.showSessionHistory()
      ),
      vscode.commands.registerCommand('codeflow.repeatAction', (actionId: string) =>
        this.repeatAction(actionId)
      ),
      vscode.commands.registerCommand('codeflow.exportSessionLog', () =>
        this.exportSessionLog()
      ),
      vscode.commands.registerCommand('codeflow.clearSessionHistory', () =>
        this.clearHistory()
      )
    );
  }

  /**
   * Register callback for history changes
   */
  onHistoryChange(callback: (actions: SessionAction[], stats: SessionStats) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of history change
   */
  private notifyChange(): void {
    const stats = this.getStats();
    this.stateCallbacks.forEach(cb => cb(this.actions, stats));
  }

  /**
   * Record an action
   */
  recordAction(
    type: SessionActionType,
    description: string,
    details?: SessionAction['details'],
    repeatCommand?: string
  ): void {
    const action: SessionAction = {
      id: `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: Date.now(),
      description,
      details,
      canRepeat: !!repeatCommand,
      repeatCommand
    };

    this.actions.unshift(action);

    // Update stats
    if (details?.filePath) {
      if (type === 'file_create') {
        this.filesCreated.add(details.filePath);
      } else if (type === 'file_edit') {
        this.filesEdited.add(details.filePath);
      }
    }

    if (details?.tokenCount) {
      this.estimatedTokens += details.tokenCount;
    }

    // Limit history size
    if (this.actions.length > 200) {
      this.actions = this.actions.slice(0, 200);
    }

    this.notifyChange();
  }

  /**
   * Record a file edit
   */
  recordFileEdit(filePath: string, description?: string): void {
    this.recordAction('file_edit', description || `Edited ${path.basename(filePath)}`, {
      filePath,
      fileName: path.basename(filePath)
    });
  }

  /**
   * Record a file creation
   */
  recordFileCreate(filePath: string): void {
    this.recordAction('file_create', `Created ${path.basename(filePath)}`, {
      filePath,
      fileName: path.basename(filePath)
    });
  }

  /**
   * Record a prompt being sent
   */
  recordPromptSent(templateName: string, tokenEstimate?: number): void {
    this.recordAction('prompt_sent', `Sent prompt: ${templateName}`, {
      promptTemplate: templateName,
      tokenCount: tokenEstimate
    }, `codeflow.runPromptTemplate:${templateName}`);
  }

  /**
   * Record an approval
   */
  recordApproval(fileName?: string): void {
    this.recordAction('approval', fileName ? `Approved changes to ${fileName}` : 'Approved changes', {
      fileName
    });
  }

  /**
   * Record a denial
   */
  recordDenial(fileName?: string): void {
    this.recordAction('denial', fileName ? `Denied changes to ${fileName}` : 'Denied changes', {
      fileName
    });
  }

  /**
   * Record an undo
   */
  recordUndo(fileName: string): void {
    this.recordAction('undo', `Undid changes to ${fileName}`, {
      fileName
    });
  }

  /**
   * Get all actions
   */
  getActions(): SessionAction[] {
    return [...this.actions];
  }

  /**
   * Get recent actions
   */
  getRecentActions(count: number = 20): SessionAction[] {
    return this.actions.slice(0, count);
  }

  /**
   * Get actions by type
   */
  getActionsByType(type: SessionActionType): SessionAction[] {
    return this.actions.filter(a => a.type === type);
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    const now = Date.now();
    
    return {
      startTime: this.sessionStartTime,
      duration: now - this.sessionStartTime,
      filesEdited: this.filesEdited.size,
      filesCreated: this.filesCreated.size,
      promptsSent: this.actions.filter(a => a.type === 'prompt_sent').length,
      approvalsGiven: this.actions.filter(a => a.type === 'approval').length,
      denialsGiven: this.actions.filter(a => a.type === 'denial').length,
      undosPerformed: this.actions.filter(a => a.type === 'undo').length,
      estimatedTokensUsed: this.estimatedTokens
    };
  }

  /**
   * Repeat an action
   */
  async repeatAction(actionId: string): Promise<void> {
    const action = this.actions.find(a => a.id === actionId);
    if (!action || !action.canRepeat || !action.repeatCommand) {
      vscode.window.showWarningMessage('CodeFlow: This action cannot be repeated');
      return;
    }

    // Parse and execute the command
    const [command, ...args] = action.repeatCommand.split(':');
    await vscode.commands.executeCommand(command, ...args);
  }

  /**
   * Show session history in quick pick
   */
  async showSessionHistory(): Promise<void> {
    const items = this.actions.map(a => ({
      label: this.getActionIcon(a.type) + ' ' + a.description,
      description: this.formatTimestamp(a.timestamp),
      detail: a.details ? JSON.stringify(a.details) : undefined,
      actionId: a.id,
      canRepeat: a.canRepeat
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Session History - Select to repeat (if available)',
      matchOnDescription: true
    });

    if (selected && selected.canRepeat) {
      await this.repeatAction(selected.actionId);
    }
  }

  /**
   * Export session log to file
   */
  async exportSessionLog(): Promise<void> {
    const stats = this.getStats();
    const log: string[] = [];

    log.push('# CodeFlow Session Log');
    log.push(`\nSession started: ${new Date(stats.startTime).toLocaleString()}`);
    log.push(`Duration: ${this.formatDuration(stats.duration)}`);
    log.push('\n## Statistics');
    log.push(`- Files edited: ${stats.filesEdited}`);
    log.push(`- Files created: ${stats.filesCreated}`);
    log.push(`- Prompts sent: ${stats.promptsSent}`);
    log.push(`- Approvals: ${stats.approvalsGiven}`);
    log.push(`- Denials: ${stats.denialsGiven}`);
    log.push(`- Undos: ${stats.undosPerformed}`);
    log.push(`- Estimated tokens: ~${Math.round(stats.estimatedTokensUsed / 1000)}k`);
    log.push('\n## Action History');

    for (const action of this.actions.slice().reverse()) {
      const time = new Date(action.timestamp).toLocaleTimeString();
      log.push(`\n### ${time} - ${action.description}`);
      if (action.details) {
        log.push('```json');
        log.push(JSON.stringify(action.details, null, 2));
        log.push('```');
      }
    }

    const content = log.join('\n');
    
    // Create new untitled document
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'markdown'
    });
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage('CodeFlow: Session log exported. Save with Ctrl+S');
  }

  /**
   * Clear history
   */
  clearHistory(): void {
    this.actions = [];
    this.filesEdited.clear();
    this.filesCreated.clear();
    this.estimatedTokens = 0;
    this.sessionStartTime = Date.now();
    this.notifyChange();
    vscode.window.showInformationMessage('CodeFlow: Session history cleared');
  }

  /**
   * Get icon for action type
   */
  private getActionIcon(type: SessionActionType): string {
    const icons: Record<SessionActionType, string> = {
      file_edit: '✏️',
      file_create: '📄',
      file_delete: '🗑️',
      prompt_sent: '💬',
      approval: '✅',
      denial: '❌',
      undo: '↩️',
      context_change: '📎',
      component_select: '🎯'
    };
    return icons[type] || '•';
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: number): string {
    const diff = Date.now() - timestamp;
    if (diff < 60000) {return 'just now';}
    if (diff < 3600000) {return `${Math.floor(diff / 60000)}m ago`;}
    return new Date(timestamp).toLocaleTimeString();
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
  }
}

// Singleton
let sessionHistoryManager: SessionHistoryManager | null = null;

export function getSessionHistoryManager(): SessionHistoryManager {
  if (!sessionHistoryManager) {
    sessionHistoryManager = new SessionHistoryManager();
  }
  return sessionHistoryManager;
}
