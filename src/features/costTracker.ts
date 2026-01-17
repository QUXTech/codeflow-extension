import * as vscode from 'vscode';

/**
 * Pricing per model (per 1M tokens as of 2024)
 */
export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

/**
 * Token usage entry
 */
export interface TokenUsageEntry {
  timestamp: number;
  inputTokens: number;
  outputTokens: number;
  model: string;
  description?: string;
}

/**
 * Current Claude model pricing (approximate)
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-3-opus': { inputPer1M: 15.00, outputPer1M: 75.00 },
  'claude-3-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3-haiku': { inputPer1M: 0.25, outputPer1M: 1.25 },
  'claude-3.5-sonnet': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-3.5-haiku': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'default': { inputPer1M: 3.00, outputPer1M: 15.00 } // Assume Sonnet
};

/**
 * Cost Tracker
 * 
 * Estimates token usage and API costs for the session.
 */
export class CostTracker {
  private usageHistory: TokenUsageEntry[] = [];
  private sessionStartTime: number = Date.now();
  private currentModel: string = 'claude-3.5-sonnet';
  private stateCallbacks: ((summary: CostSummary) => void)[] = [];

  // Token estimation constants
  private readonly CHARS_PER_TOKEN = 4;

  constructor() {
    this.loadSettings();
  }

  /**
   * Load settings
   */
  private loadSettings(): void {
    const config = vscode.workspace.getConfiguration('codeflow');
    this.currentModel = config.get<string>('claudeModel') || 'claude-3.5-sonnet';
  }

  /**
   * Initialize with extension context
   */
  initialize(context: vscode.ExtensionContext): void {
    // Watch for configuration changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('codeflow.claudeModel')) {
          this.loadSettings();
        }
      })
    );

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand('codeflow.showCostSummary', () =>
        this.showCostSummary()
      ),
      vscode.commands.registerCommand('codeflow.resetCostTracker', () =>
        this.resetTracker()
      )
    );
  }

  /**
   * Register callback for cost updates
   */
  onCostUpdate(callback: (summary: CostSummary) => void): void {
    this.stateCallbacks.push(callback);
  }

  /**
   * Notify callbacks of cost update
   */
  private notifyChange(): void {
    const summary = this.getSummary();
    this.stateCallbacks.forEach(cb => cb(summary));
  }

  /**
   * Estimate tokens from text
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Record token usage
   */
  recordUsage(
    inputTokens: number,
    outputTokens: number,
    description?: string,
    model?: string
  ): void {
    const entry: TokenUsageEntry = {
      timestamp: Date.now(),
      inputTokens,
      outputTokens,
      model: model || this.currentModel,
      description
    };

    this.usageHistory.push(entry);
    this.notifyChange();

    // Limit history
    if (this.usageHistory.length > 500) {
      this.usageHistory = this.usageHistory.slice(-500);
    }
  }

  /**
   * Record usage from context content
   */
  recordContextUsage(contextContent: string, description?: string): void {
    const inputTokens = this.estimateTokens(contextContent);
    // Estimate output as ~20% of input for typical responses
    const outputTokens = Math.ceil(inputTokens * 0.2);
    
    this.recordUsage(inputTokens, outputTokens, description);
  }

  /**
   * Calculate cost for tokens
   */
  calculateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const pricing = MODEL_PRICING[model || this.currentModel] || MODEL_PRICING['default'];
    
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    
    return inputCost + outputCost;
  }

  /**
   * Get total tokens used
   */
  getTotalTokens(): { input: number; output: number } {
    return this.usageHistory.reduce(
      (acc, entry) => ({
        input: acc.input + entry.inputTokens,
        output: acc.output + entry.outputTokens
      }),
      { input: 0, output: 0 }
    );
  }

  /**
   * Get total cost
   */
  getTotalCost(): number {
    return this.usageHistory.reduce(
      (total, entry) => total + this.calculateCost(entry.inputTokens, entry.outputTokens, entry.model),
      0
    );
  }

  /**
   * Get cost summary
   */
  getSummary(): CostSummary {
    const tokens = this.getTotalTokens();
    const totalCost = this.getTotalCost();
    const requestCount = this.usageHistory.length;
    const duration = Date.now() - this.sessionStartTime;

    // Calculate rate
    const hoursElapsed = duration / 3600000;
    const costPerHour = hoursElapsed > 0 ? totalCost / hoursElapsed : 0;

    return {
      totalInputTokens: tokens.input,
      totalOutputTokens: tokens.output,
      totalTokens: tokens.input + tokens.output,
      totalCost,
      requestCount,
      sessionDuration: duration,
      costPerHour,
      model: this.currentModel,
      history: this.usageHistory.slice(-20)
    };
  }

  /**
   * Show cost summary in notification
   */
  showCostSummary(): void {
    const summary = this.getSummary();
    
    const message = [
      `💰 Session Cost Estimate`,
      ``,
      `Tokens: ${this.formatNumber(summary.totalTokens)} (${this.formatNumber(summary.totalInputTokens)} in / ${this.formatNumber(summary.totalOutputTokens)} out)`,
      `Requests: ${summary.requestCount}`,
      `Estimated Cost: $${summary.totalCost.toFixed(4)}`,
      `Rate: ~$${summary.costPerHour.toFixed(2)}/hour`,
      `Model: ${summary.model}`
    ].join('\n');

    vscode.window.showInformationMessage(message, { modal: true }, 'Reset Tracker')
      .then(action => {
        if (action === 'Reset Tracker') {
          this.resetTracker();
        }
      });
  }

  /**
   * Reset the tracker
   */
  resetTracker(): void {
    this.usageHistory = [];
    this.sessionStartTime = Date.now();
    this.notifyChange();
    vscode.window.showInformationMessage('CodeFlow: Cost tracker reset');
  }

  /**
   * Format large numbers
   */
  private formatNumber(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}k`;
    }
    return num.toString();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.stateCallbacks = [];
  }
}

/**
 * Cost summary interface
 */
export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
  sessionDuration: number;
  costPerHour: number;
  model: string;
  history: TokenUsageEntry[];
}

// Singleton
let costTracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!costTracker) {
    costTracker = new CostTracker();
  }
  return costTracker;
}
