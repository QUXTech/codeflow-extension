import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ComponentGraph } from '../types';

/**
 * Context file entry
 */
export interface ContextFile {
  filePath: string;
  fileName: string;
  relativePath: string;
  selected: boolean;
  tokenEstimate: number;
  componentId?: string;
  componentType?: string;
}

/**
 * Context File Selector
 * 
 * Allows users to visually select which files to include in Claude's context.
 * Provides token estimation and @file reference generation.
 */
export class ContextSelector {
  private selectedFiles: Map<string, ContextFile> = new Map();
  private workspaceRoot: string | null = null;
  private stateCallbacks: ((files: ContextFile[]) => void)[] = [];

  // Rough token estimation (4 chars ≈ 1 token)
  private readonly CHARS_PER_TOKEN = 4;
  private readonly MAX_RECOMMENDED_TOKENS = 100000;

  constructor() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.addFileToContext', (filePath?: string) =>
        this.addFileToContext(filePath)
      ),
      vscode.commands.registerCommand('codeflow.removeFileFromContext', (filePath: string) =>
        this.removeFileFromContext(filePath)
      ),
      vscode.commands.registerCommand('codeflow.clearContext', () =>
        this.clearContext()
      ),
      vscode.commands.registerCommand('codeflow.copyContextAsReferences', () =>
        this.copyAsReferences()
      ),
      vscode.commands.registerCommand('codeflow.copyContextContent', () =>
        this.copyContextContent()
      ),
      vscode.commands.registerCommand('codeflow.addComponentToContext', (componentId: string) =>
        this.addComponentToContext(componentId)
      )
    );
  }

  /**
   * Register callback for selection changes
   */
  onSelectionChange(callback: (files: ContextFile[]) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of selection change
   */
  private notifyChange(): void {
    this.stateCallbacks.forEach(cb => cb(this.getSelectedFiles()));
  }

  /**
   * Add a file to the context
   */
  async addFileToContext(filePath?: string): Promise<void> {
    // If no path provided, use active editor
    if (!filePath) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('CodeFlow: No file open');
        return;
      }
      filePath = editor.document.uri.fsPath;
    }

    if (this.selectedFiles.has(filePath)) {
      vscode.window.showInformationMessage('CodeFlow: File already in context');
      return;
    }

    try {
      const _stats = await fs.promises.stat(filePath);
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const tokenEstimate = Math.ceil(content.length / this.CHARS_PER_TOKEN);

      const contextFile: ContextFile = {
        filePath,
        fileName: path.basename(filePath),
        relativePath: this.workspaceRoot 
          ? path.relative(this.workspaceRoot, filePath)
          : filePath,
        selected: true,
        tokenEstimate
      };

      this.selectedFiles.set(filePath, contextFile);
      this.notifyChange();

      // Warn if context is getting large
      const totalTokens = this.getTotalTokenEstimate();
      if (totalTokens > this.MAX_RECOMMENDED_TOKENS) {
        vscode.window.showWarningMessage(
          `CodeFlow: Context is large (~${Math.round(totalTokens / 1000)}k tokens). Consider removing some files.`
        );
      }

    } catch (error) {
      vscode.window.showErrorMessage(`CodeFlow: Failed to add file - ${error}`);
    }
  }

  /**
   * Add a component from the graph to context
   */
  async addComponentToContext(componentId: string, graph?: ComponentGraph): Promise<void> {
    if (!graph) {return;}

    const component = graph.nodes.find(n => n.id === componentId);
    if (!component) {return;}

    await this.addFileToContext(component.filePath);

    // Update the context file with component info
    const contextFile = this.selectedFiles.get(component.filePath);
    if (contextFile) {
      contextFile.componentId = component.id;
      contextFile.componentType = component.type;
      this.notifyChange();
    }
  }

  /**
   * Add multiple components to context
   */
  async addComponentsToContext(componentIds: string[], graph: ComponentGraph): Promise<void> {
    for (const id of componentIds) {
      await this.addComponentToContext(id, graph);
    }
  }

  /**
   * Remove a file from context
   */
  removeFileFromContext(filePath: string): void {
    if (this.selectedFiles.delete(filePath)) {
      this.notifyChange();
    }
  }

  /**
   * Toggle a file's selection
   */
  toggleFile(filePath: string): void {
    const file = this.selectedFiles.get(filePath);
    if (file) {
      file.selected = !file.selected;
      this.notifyChange();
    }
  }

  /**
   * Clear all context files
   */
  clearContext(): void {
    this.selectedFiles.clear();
    this.notifyChange();
    vscode.window.showInformationMessage('CodeFlow: Context cleared');
  }

  /**
   * Get all selected files
   */
  getSelectedFiles(): ContextFile[] {
    return Array.from(this.selectedFiles.values()).filter(f => f.selected);
  }

  /**
   * Get all files (including unselected)
   */
  getAllFiles(): ContextFile[] {
    return Array.from(this.selectedFiles.values());
  }

  /**
   * Get total token estimate
   */
  getTotalTokenEstimate(): number {
    return this.getSelectedFiles().reduce((sum, f) => sum + f.tokenEstimate, 0);
  }

  /**
   * Copy selected files as @file references for Claude CLI
   */
  async copyAsReferences(): Promise<void> {
    const files = this.getSelectedFiles();
    if (files.length === 0) {
      vscode.window.showWarningMessage('CodeFlow: No files selected');
      return;
    }

    const references = files
      .map(f => `@${f.relativePath}`)
      .join(' ');

    await vscode.env.clipboard.writeText(references);
    vscode.window.showInformationMessage(
      `CodeFlow: ${files.length} file reference(s) copied to clipboard`
    );
  }

  /**
   * Copy the actual content of selected files
   */
  async copyContextContent(): Promise<void> {
    const files = this.getSelectedFiles();
    if (files.length === 0) {
      vscode.window.showWarningMessage('CodeFlow: No files selected');
      return;
    }

    const contents: string[] = [];

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file.filePath, 'utf-8');
        contents.push(`// File: ${file.relativePath}\n${content}`);
      } catch (error) {
        contents.push(`// File: ${file.relativePath}\n// Error reading file`);
      }
    }

    const fullContent = contents.join('\n\n' + '='.repeat(50) + '\n\n');
    await vscode.env.clipboard.writeText(fullContent);
    
    vscode.window.showInformationMessage(
      `CodeFlow: Content of ${files.length} file(s) copied (~${Math.round(this.getTotalTokenEstimate() / 1000)}k tokens)`
    );
  }

  /**
   * Get context summary for display
   */
  getContextSummary(): {
    fileCount: number;
    totalTokens: number;
    isLarge: boolean;
    files: ContextFile[];
  } {
    const files = this.getSelectedFiles();
    const totalTokens = this.getTotalTokenEstimate();

    return {
      fileCount: files.length,
      totalTokens,
      isLarge: totalTokens > this.MAX_RECOMMENDED_TOKENS,
      files
    };
  }

  /**
   * Auto-select related files based on imports
   */
  async autoSelectRelated(filePath: string, graph?: ComponentGraph): Promise<void> {
    if (!graph) {return;}

    // Find the component for this file
    const component = graph.nodes.find(n => n.filePath === filePath);
    if (!component) {return;}

    // Find all directly connected components
    const relatedIds = new Set<string>();
    
    for (const edge of graph.edges) {
      if (edge.source === component.id) {
        relatedIds.add(edge.target);
      }
      if (edge.target === component.id) {
        relatedIds.add(edge.source);
      }
    }

    // Add related files to context
    for (const id of relatedIds) {
      const related = graph.nodes.find(n => n.id === id);
      if (related && !this.selectedFiles.has(related.filePath)) {
        await this.addFileToContext(related.filePath);
      }
    }

    vscode.window.showInformationMessage(
      `CodeFlow: Added ${relatedIds.size} related files to context`
    );
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
    this.selectedFiles.clear();
  }
}

// Singleton
let contextSelector: ContextSelector | null = null;

export function getContextSelector(): ContextSelector {
  if (!contextSelector) {
    contextSelector = new ContextSelector();
  }
  return contextSelector;
}
