import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Diff entry representing a pending change
 */
export interface DiffEntry {
  id: string;
  filePath: string;
  fileName: string;
  oldContent: string;
  newContent: string;
  diffLines: DiffLine[];
  additions: number;
  deletions: number;
  timestamp: number;
  status: 'pending' | 'approved' | 'denied' | 'modified';
}

/**
 * Single line in a diff
 */
export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
}

/**
 * Diff Preview Manager
 * 
 * Shows visual diffs of pending changes and allows approve/deny/edit actions.
 */
export class DiffPreviewManager {
  private pendingDiffs: Map<string, DiffEntry> = new Map();
  private workspaceRoot: string | null = null;
  private stateCallbacks: ((diffs: DiffEntry[]) => void)[] = [];
  private isGitRepo: boolean = false;

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
      this.checkGitRepo();
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
    } catch {
      this.isGitRepo = false;
    }
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Watch for file changes to detect diffs
    const watcher = vscode.workspace.onDidChangeTextDocument(async (e) => {
      if (e.document.uri.scheme === 'file' && e.contentChanges.length > 0) {
        await this.detectDiff(e.document.uri.fsPath);
      }
    });

    context.subscriptions.push(watcher);

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.showDiffPreview', (filePath: string) =>
        this.showDiffPreview(filePath)
      ),
      vscode.commands.registerCommand('codeflow.approveDiff', (diffId: string) =>
        this.approveDiff(diffId)
      ),
      vscode.commands.registerCommand('codeflow.denyDiff', (diffId: string) =>
        this.denyDiff(diffId)
      ),
      vscode.commands.registerCommand('codeflow.editBeforeApprove', (diffId: string) =>
        this.editBeforeApprove(diffId)
      )
    );
  }

  /**
   * Register callback for diff changes
   */
  onDiffsChange(callback: (diffs: DiffEntry[]) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of diff change
   */
  private notifyChange(): void {
    this.stateCallbacks.forEach(cb => cb(this.getPendingDiffs()));
  }

  /**
   * Detect diff for a file
   */
  async detectDiff(filePath: string): Promise<DiffEntry | null> {
    if (!this.workspaceRoot) {return null;}

    try {
      // Get the original content from Git or cache
      const oldContent = await this.getOriginalContent(filePath);
      if (oldContent === null) {return null;}

      // Get current content
      const document = await vscode.workspace.openTextDocument(filePath);
      const newContent = document.getText();

      // Skip if content hasn't changed
      if (oldContent === newContent) {
        this.pendingDiffs.delete(filePath);
        this.notifyChange();
        return null;
      }

      // Generate diff
      const diffLines = this.generateDiffLines(oldContent, newContent);
      const { additions, deletions } = this.countChanges(diffLines);

      const entry: DiffEntry = {
        id: `diff_${Date.now()}`,
        filePath,
        fileName: path.basename(filePath),
        oldContent,
        newContent,
        diffLines,
        additions,
        deletions,
        timestamp: Date.now(),
        status: 'pending'
      };

      this.pendingDiffs.set(filePath, entry);
      this.notifyChange();
      return entry;

    } catch (error) {
      console.error('CodeFlow: Error detecting diff', error);
      return null;
    }
  }

  /**
   * Get original content from Git or last known state
   */
  private async getOriginalContent(filePath: string): Promise<string | null> {
    if (!this.workspaceRoot) {return null;}

    // Try Git first
    if (this.isGitRepo) {
      try {
        const relativePath = path.relative(this.workspaceRoot, filePath);
        const { stdout } = await execAsync(
          `git show HEAD:"${relativePath}"`,
          { cwd: this.workspaceRoot }
        );
        return stdout;
      } catch {
        // File might not be tracked
      }
    }

    // Check if we have a cached version
    const existing = this.pendingDiffs.get(filePath);
    if (existing) {
      return existing.oldContent;
    }

    return null;
  }

  /**
   * Generate diff lines from old and new content
   */
  private generateDiffLines(oldContent: string, newContent: string): DiffLine[] {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const diffLines: DiffLine[] = [];

    // Simple line-by-line diff (could use a proper diff algorithm for better results)
    const _maxLines = Math.max(oldLines.length, newLines.length);
    
    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldLines[oldIdx];
      const newLine = newLines[newIdx];

      if (oldLine === newLine) {
        // Context line
        diffLines.push({
          type: 'context',
          content: oldLine || '',
          oldLineNum: oldIdx + 1,
          newLineNum: newIdx + 1
        });
        oldIdx++;
        newIdx++;
      } else if (oldIdx >= oldLines.length) {
        // Addition at end
        diffLines.push({
          type: 'add',
          content: newLine,
          newLineNum: newIdx + 1
        });
        newIdx++;
      } else if (newIdx >= newLines.length) {
        // Deletion at end
        diffLines.push({
          type: 'remove',
          content: oldLine,
          oldLineNum: oldIdx + 1
        });
        oldIdx++;
      } else {
        // Changed line - show as removal then addition
        diffLines.push({
          type: 'remove',
          content: oldLine,
          oldLineNum: oldIdx + 1
        });
        diffLines.push({
          type: 'add',
          content: newLine,
          newLineNum: newIdx + 1
        });
        oldIdx++;
        newIdx++;
      }
    }

    return diffLines;
  }

  /**
   * Count additions and deletions
   */
  private countChanges(diffLines: DiffLine[]): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;

    for (const line of diffLines) {
      if (line.type === 'add') {additions++;}
      if (line.type === 'remove') {deletions++;}
    }

    return { additions, deletions };
  }

  /**
   * Get all pending diffs
   */
  getPendingDiffs(): DiffEntry[] {
    return Array.from(this.pendingDiffs.values())
      .filter(d => d.status === 'pending')
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Get diff for a specific file
   */
  getDiff(filePath: string): DiffEntry | undefined {
    return this.pendingDiffs.get(filePath);
  }

  /**
   * Show diff preview in VS Code's diff editor
   */
  async showDiffPreview(filePath: string): Promise<void> {
    const diff = this.pendingDiffs.get(filePath);
    if (!diff) {
      vscode.window.showWarningMessage('CodeFlow: No diff available for this file');
      return;
    }

    // Create temporary file for original content
    const originalUri = vscode.Uri.parse(`codeflow-diff-original:${diff.fileName}`);
    const modifiedUri = vscode.Uri.file(filePath);

    // Use VS Code's diff editor
    await vscode.commands.executeCommand('vscode.diff',
      originalUri,
      modifiedUri,
      `${diff.fileName}: Original ↔ Modified`
    );
  }

  /**
   * Approve a diff (keep the changes)
   */
  async approveDiff(diffId: string): Promise<void> {
    const diff = Array.from(this.pendingDiffs.values()).find(d => d.id === diffId);
    if (!diff) {return;}

    diff.status = 'approved';
    this.pendingDiffs.delete(diff.filePath);
    this.notifyChange();

    vscode.window.showInformationMessage(`CodeFlow: Changes to ${diff.fileName} approved`);
  }

  /**
   * Deny a diff (revert the changes)
   */
  async denyDiff(diffId: string): Promise<void> {
    const diff = Array.from(this.pendingDiffs.values()).find(d => d.id === diffId);
    if (!diff) {return;}

    try {
      // Revert to original content
      const uri = vscode.Uri.file(diff.filePath);
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(uri, fullRange, diff.oldContent);
      await vscode.workspace.applyEdit(edit);
      await document.save();

      diff.status = 'denied';
      this.pendingDiffs.delete(diff.filePath);
      this.notifyChange();

      vscode.window.showInformationMessage(`CodeFlow: Changes to ${diff.fileName} reverted`);

    } catch (error) {
      vscode.window.showErrorMessage(`CodeFlow: Failed to revert changes - ${error}`);
    }
  }

  /**
   * Open file for editing before approving
   */
  async editBeforeApprove(diffId: string): Promise<void> {
    const diff = Array.from(this.pendingDiffs.values()).find(d => d.id === diffId);
    if (!diff) {return;}

    diff.status = 'modified';
    
    // Open the file in editor
    const document = await vscode.workspace.openTextDocument(diff.filePath);
    await vscode.window.showTextDocument(document);

    vscode.window.showInformationMessage(
      'CodeFlow: Edit the file, then save to update the diff'
    );
  }

  /**
   * Generate unified diff format string
   */
  generateUnifiedDiff(entry: DiffEntry): string {
    const lines: string[] = [];
    lines.push(`--- a/${entry.fileName}`);
    lines.push(`+++ b/${entry.fileName}`);
    lines.push('@@ -1 +1 @@');

    for (const line of entry.diffLines) {
      const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
      lines.push(`${prefix}${line.content}`);
    }

    return lines.join('\n');
  }

  /**
   * Get summary of all pending changes
   */
  getSummary(): {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
    diffs: DiffEntry[];
  } {
    const diffs = this.getPendingDiffs();
    
    return {
      totalFiles: diffs.length,
      totalAdditions: diffs.reduce((sum, d) => sum + d.additions, 0),
      totalDeletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
      diffs
    };
  }

  /**
   * Clear all pending diffs
   */
  clearAllDiffs(): void {
    this.pendingDiffs.clear();
    this.notifyChange();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
    this.pendingDiffs.clear();
  }
}

// Singleton
let diffPreviewManager: DiffPreviewManager | null = null;

export function getDiffPreviewManager(): DiffPreviewManager {
  if (!diffPreviewManager) {
    diffPreviewManager = new DiffPreviewManager();
  }
  return diffPreviewManager;
}
