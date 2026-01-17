import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Edit history entry for rollback functionality
 */
export interface EditHistoryEntry {
  id: string;
  filePath: string;
  fileName: string;
  timestamp: number;
  commitHash?: string;
  previousContent?: string;
  description?: string;
  canUndo: boolean;
}

/**
 * Git-based Undo/Rollback System
 * 
 * Tracks file changes and provides rollback capabilities using Git
 * or in-memory snapshots as fallback.
 */
export class UndoManager {
  private editHistory: EditHistoryEntry[] = [];
  private fileSnapshots: Map<string, string> = new Map();
  private workspaceRoot: string | null = null;
  private isGitRepo: boolean = false;
  private maxHistorySize: number = 50;
  private stateCallbacks: ((history: EditHistoryEntry[]) => void)[] = [];

  constructor() {
    this.detectWorkspace();
  }

  /**
   * Initialize and detect workspace
   */
  private async detectWorkspace(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      await this.checkGitRepo();
    }
  }

  /**
   * Check if workspace is a Git repository
   */
  private async checkGitRepo(): Promise<void> {
    if (!this.workspaceRoot) {return;}

    try {
      await execAsync('git rev-parse --git-dir', { cwd: this.workspaceRoot });
      this.isGitRepo = true;
      console.log('CodeFlow: Git repository detected');
    } catch {
      this.isGitRepo = false;
      console.log('CodeFlow: No Git repository, using in-memory snapshots');
    }
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Watch for file changes to capture snapshots
    const watcher = vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.uri.scheme === 'file') {
        await this.captureSnapshot(e.document.uri.fsPath);
      }
    });

    // Watch for file saves to record history
    const saveWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (document.uri.scheme === 'file') {
        await this.recordEdit(document.uri.fsPath);
      }
    });

    context.subscriptions.push(watcher, saveWatcher);

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.undoFileEdit', (filePath: string) => 
        this.undoFileEdit(filePath)
      ),
      vscode.commands.registerCommand('codeflow.rollbackSession', () => 
        this.rollbackSession()
      ),
      vscode.commands.registerCommand('codeflow.clearHistory', () => 
        this.clearHistory()
      )
    );
  }

  /**
   * Register callback for history changes
   */
  onHistoryChange(callback: (history: EditHistoryEntry[]) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of history change
   */
  private notifyChange(): void {
    this.stateCallbacks.forEach(cb => cb(this.getHistory()));
  }

  /**
   * Capture a snapshot of a file before changes
   */
  private async captureSnapshot(filePath: string): Promise<void> {
    // Only capture if we don't already have a snapshot for this file
    if (this.fileSnapshots.has(filePath)) {return;}

    try {
      const document = await vscode.workspace.openTextDocument(filePath);
      this.fileSnapshots.set(filePath, document.getText());
    } catch (error) {
      // File might not exist yet
    }
  }

  /**
   * Record an edit in the history
   */
  async recordEdit(filePath: string, description?: string): Promise<void> {
    const entry: EditHistoryEntry = {
      id: this.generateId(),
      filePath,
      fileName: path.basename(filePath),
      timestamp: Date.now(),
      description,
      canUndo: true
    };

    // Try to get Git commit hash if available
    if (this.isGitRepo && this.workspaceRoot) {
      try {
        const { stdout } = await execAsync(
          'git rev-parse HEAD',
          { cwd: this.workspaceRoot }
        );
        entry.commitHash = stdout.trim();
      } catch {
        // Not committed yet
      }
    }

    // Store the previous content for non-Git rollback
    if (this.fileSnapshots.has(filePath)) {
      entry.previousContent = this.fileSnapshots.get(filePath);
      this.fileSnapshots.delete(filePath); // Clear snapshot after recording
    }

    // Add to history
    this.editHistory.unshift(entry);

    // Trim history if needed
    if (this.editHistory.length > this.maxHistorySize) {
      this.editHistory = this.editHistory.slice(0, this.maxHistorySize);
    }

    this.notifyChange();
  }

  /**
   * Get edit history
   */
  getHistory(): EditHistoryEntry[] {
    return [...this.editHistory];
  }

  /**
   * Get recent edits (last N)
   */
  getRecentEdits(count: number = 10): EditHistoryEntry[] {
    return this.editHistory.slice(0, count);
  }

  /**
   * Undo a specific file edit
   */
  async undoFileEdit(filePath: string): Promise<boolean> {
    const entry = this.editHistory.find(e => e.filePath === filePath && e.canUndo);
    if (!entry) {
      vscode.window.showWarningMessage(`CodeFlow: No undo available for ${path.basename(filePath)}`);
      return false;
    }

    try {
      // Try Git checkout first
      if (this.isGitRepo && this.workspaceRoot && entry.commitHash) {
        await execAsync(
          `git checkout HEAD~1 -- "${path.relative(this.workspaceRoot, filePath)}"`,
          { cwd: this.workspaceRoot }
        );
        vscode.window.showInformationMessage(`CodeFlow: Reverted ${entry.fileName} using Git`);
      } 
      // Fall back to in-memory snapshot
      else if (entry.previousContent !== undefined) {
        const uri = vscode.Uri.file(filePath);
        const edit = new vscode.WorkspaceEdit();
        const document = await vscode.workspace.openTextDocument(uri);
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(document.getText().length)
        );
        edit.replace(uri, fullRange, entry.previousContent);
        await vscode.workspace.applyEdit(edit);
        await document.save();
        vscode.window.showInformationMessage(`CodeFlow: Reverted ${entry.fileName} from snapshot`);
      } else {
        vscode.window.showWarningMessage(`CodeFlow: No previous version available for ${entry.fileName}`);
        return false;
      }

      // Mark as undone
      entry.canUndo = false;
      this.notifyChange();
      return true;

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`CodeFlow: Failed to undo - ${message}`);
      return false;
    }
  }

  /**
   * Rollback all changes in the current session
   */
  async rollbackSession(): Promise<void> {
    const undoableEdits = this.editHistory.filter(e => e.canUndo);
    
    if (undoableEdits.length === 0) {
      vscode.window.showInformationMessage('CodeFlow: No changes to rollback');
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `CodeFlow: Rollback ${undoableEdits.length} file changes?`,
      { modal: true },
      'Rollback All',
      'Cancel'
    );

    if (confirm !== 'Rollback All') {return;}

    let successCount = 0;
    let failCount = 0;

    for (const entry of undoableEdits) {
      const success = await this.undoFileEdit(entry.filePath);
      if (success) {successCount++;}
      else {failCount++;}
    }

    vscode.window.showInformationMessage(
      `CodeFlow: Rolled back ${successCount} files` + 
      (failCount > 0 ? `, ${failCount} failed` : '')
    );
  }

  /**
   * Create a Git stash of current changes
   */
  async stashChanges(message?: string): Promise<boolean> {
    if (!this.isGitRepo || !this.workspaceRoot) {
      vscode.window.showWarningMessage('CodeFlow: Git not available for stash');
      return false;
    }

    try {
      const stashMessage = message || `CodeFlow session ${new Date().toISOString()}`;
      await execAsync(`git stash push -m "${stashMessage}"`, { cwd: this.workspaceRoot });
      vscode.window.showInformationMessage('CodeFlow: Changes stashed');
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`CodeFlow: Stash failed - ${msg}`);
      return false;
    }
  }

  /**
   * Get Git diff for a file
   */
  async getFileDiff(filePath: string): Promise<string | null> {
    if (!this.isGitRepo || !this.workspaceRoot) {return null;}

    try {
      const relativePath = path.relative(this.workspaceRoot, filePath);
      const { stdout } = await execAsync(
        `git diff HEAD -- "${relativePath}"`,
        { cwd: this.workspaceRoot }
      );
      return stdout;
    } catch {
      return null;
    }
  }

  /**
   * Clear edit history
   */
  clearHistory(): void {
    this.editHistory = [];
    this.fileSnapshots.clear();
    this.notifyChange();
    vscode.window.showInformationMessage('CodeFlow: Edit history cleared');
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `edit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
    this.fileSnapshots.clear();
  }
}

// Singleton
let undoManager: UndoManager | null = null;

export function getUndoManager(): UndoManager {
  if (!undoManager) {
    undoManager = new UndoManager();
  }
  return undoManager;
}
