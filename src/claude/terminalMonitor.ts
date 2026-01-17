import * as vscode from 'vscode';
import { minimatch } from 'minimatch';

/**
 * Terminal Monitor for Claude CLI
 * 
 * Monitors VS Code terminals for Claude CLI permission prompts and can
 * automatically approve them or provide quick UI controls.
 */

/** State of the auto-approve feature */
export interface AutoApproveState {
  enabled: boolean;
  patterns: string[];
  approvedCount: number;
  deniedCount: number;
  lastAction: { type: 'approve' | 'deny'; file?: string; timestamp: number } | null;
}

/** Callback for state changes */
type StateChangeCallback = (state: AutoApproveState) => void;

export class TerminalMonitor {
  private state: AutoApproveState = {
    enabled: false,
    patterns: [],
    approvedCount: 0,
    deniedCount: 0,
    lastAction: null
  };

  private stateCallbacks: StateChangeCallback[] = [];
  private terminalDataListener: vscode.Disposable | null = null;
  private claudeTerminal: vscode.Terminal | null = null;
  private pendingPrompt: { file?: string; detected: number } | null = null;
  private writeEmitter: vscode.EventEmitter<string> | null = null;

  constructor() {
    this.loadSettings();
  }

  /**
   * Load settings from VS Code configuration
   */
  private loadSettings(): void {
    const config = vscode.workspace.getConfiguration('codeflow');
    this.state.enabled = config.get<boolean>('autoApproveEdits') || false;
    this.state.patterns = config.get<string[]>('autoApprovePatterns') || [];
  }

  /**
   * Initialize terminal monitoring
   */
  initialize(context: vscode.ExtensionContext): void {
    // Watch for terminal creation
    context.subscriptions.push(
      vscode.window.onDidOpenTerminal(terminal => {
        this.checkTerminal(terminal);
      })
    );

    // Watch for terminal close
    context.subscriptions.push(
      vscode.window.onDidCloseTerminal(terminal => {
        if (terminal === this.claudeTerminal) {
          this.claudeTerminal = null;
          this.pendingPrompt = null;
        }
      })
    );

    // Check existing terminals
    vscode.window.terminals.forEach(terminal => {
      this.checkTerminal(terminal);
    });

    // Watch for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('codeflow.autoApproveEdits') ||
            e.affectsConfiguration('codeflow.autoApprovePatterns')) {
          this.loadSettings();
          this.notifyStateChange();
        }
      })
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.approveEdit', () => this.approveCurrentEdit()),
      vscode.commands.registerCommand('codeflow.denyEdit', () => this.denyCurrentEdit()),
      vscode.commands.registerCommand('codeflow.toggleAutoApprove', () => this.toggleAutoApprove())
    );
  }

  /**
   * Check if a terminal is the Claude CLI terminal
   */
  private checkTerminal(terminal: vscode.Terminal): void {
    const config = vscode.workspace.getConfiguration('codeflow');
    const terminalName = config.get<string>('terminalName') || 'claude';

    // Check if terminal name contains 'claude' or matches configured name
    if (terminal.name.toLowerCase().includes(terminalName.toLowerCase()) ||
        terminal.name.toLowerCase().includes('claude')) {
      this.claudeTerminal = terminal;
      console.log('CodeFlow: Found Claude CLI terminal:', terminal.name);
    }
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: StateChangeCallback): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify all callbacks of state change
   */
  private notifyStateChange(): void {
    this.stateCallbacks.forEach(cb => cb(this.state));
  }

  /**
   * Get current state
   */
  getState(): AutoApproveState {
    return { ...this.state };
  }

  /**
   * Toggle auto-approve mode
   */
  toggleAutoApprove(): void {
    this.state.enabled = !this.state.enabled;
    
    // Save to settings
    const config = vscode.workspace.getConfiguration('codeflow');
    config.update('autoApproveEdits', this.state.enabled, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(
      `CodeFlow: Auto-approve ${this.state.enabled ? 'ENABLED' : 'DISABLED'}`
    );

    this.notifyStateChange();
  }

  /**
   * Set auto-approve state directly
   */
  setAutoApprove(enabled: boolean): void {
    if (this.state.enabled !== enabled) {
      this.state.enabled = enabled;
      
      const config = vscode.workspace.getConfiguration('codeflow');
      config.update('autoApproveEdits', enabled, vscode.ConfigurationTarget.Global);
      
      this.notifyStateChange();
    }
  }

  /**
   * Check if a file matches auto-approve patterns
   */
  private fileMatchesPatterns(filePath: string): boolean {
    // If no patterns specified, approve all when enabled
    if (this.state.patterns.length === 0) {
      return true;
    }

    // Check if file matches any pattern
    return this.state.patterns.some(pattern => {
      try {
        return minimatch(filePath, pattern, { matchBase: true });
      } catch {
        return false;
      }
    });
  }

  /**
   * Approve the current pending edit
   */
  approveCurrentEdit(): void {
    if (!this.claudeTerminal) {
      this.findOrNotifyNoTerminal();
      return;
    }

    // Send 'y' to the terminal
    this.claudeTerminal.sendText('y', true);
    
    this.state.approvedCount++;
    this.state.lastAction = {
      type: 'approve',
      file: this.pendingPrompt?.file,
      timestamp: Date.now()
    };
    this.pendingPrompt = null;
    
    this.notifyStateChange();
    
    // Brief notification
    vscode.window.setStatusBarMessage('✅ CodeFlow: Approved', 2000);
  }

  /**
   * Deny the current pending edit
   */
  denyCurrentEdit(): void {
    if (!this.claudeTerminal) {
      this.findOrNotifyNoTerminal();
      return;
    }

    // Send 'n' to the terminal
    this.claudeTerminal.sendText('n', true);
    
    this.state.deniedCount++;
    this.state.lastAction = {
      type: 'deny',
      file: this.pendingPrompt?.file,
      timestamp: Date.now()
    };
    this.pendingPrompt = null;
    
    this.notifyStateChange();
    
    // Brief notification
    vscode.window.setStatusBarMessage('❌ CodeFlow: Denied', 2000);
  }

  /**
   * Find Claude terminal or notify user
   */
  private findOrNotifyNoTerminal(): void {
    // Try to find it again
    const found = vscode.window.terminals.find(t => 
      t.name.toLowerCase().includes('claude')
    );

    if (found) {
      this.claudeTerminal = found;
      vscode.window.showInformationMessage('CodeFlow: Found Claude terminal. Try again.');
    } else {
      vscode.window.showWarningMessage(
        'CodeFlow: No Claude CLI terminal found. Start Claude CLI first.'
      );
    }
  }

  /**
   * Simulate detecting a permission prompt (for UI testing)
   * In a real implementation, this would be called by terminal data parsing
   */
  simulatePromptDetected(filePath?: string): void {
    this.pendingPrompt = {
      file: filePath,
      detected: Date.now()
    };

    // Set context for keybindings
    vscode.commands.executeCommand('setContext', 'codeflow.hasPendingApproval', true);

    // If auto-approve is on and file matches patterns, auto-approve
    if (this.state.enabled) {
      if (!filePath || this.fileMatchesPatterns(filePath)) {
        setTimeout(() => this.approveCurrentEdit(), 100);
        return;
      }
    }

    // Otherwise, notify user
    this.notifyStateChange();
  }

  /**
   * Clear pending prompt state
   */
  clearPendingPrompt(): void {
    this.pendingPrompt = null;
    vscode.commands.executeCommand('setContext', 'codeflow.hasPendingApproval', false);
    this.notifyStateChange();
  }

  /**
   * Check if there's a pending prompt
   */
  hasPendingPrompt(): boolean {
    return this.pendingPrompt !== null;
  }

  /**
   * Get pending prompt info
   */
  getPendingPrompt(): { file?: string; detected: number } | null {
    return this.pendingPrompt;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.state.approvedCount = 0;
    this.state.deniedCount = 0;
    this.state.lastAction = null;
    this.notifyStateChange();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    if (this.terminalDataListener) {
      this.terminalDataListener.dispose();
    }
    this.stateCallbacks = [];
  }
}

// Singleton instance
let terminalMonitor: TerminalMonitor | null = null;

export function getTerminalMonitor(): TerminalMonitor {
  if (!terminalMonitor) {
    terminalMonitor = new TerminalMonitor();
  }
  return terminalMonitor;
}
