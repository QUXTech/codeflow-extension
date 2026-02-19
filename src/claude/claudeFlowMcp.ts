import * as vscode from 'vscode';
import { ComponentGraph, ComponentNode, EditStatus } from '../types';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Claude Flow MCP Integration
 *
 * Integrates CodeFlow with Claude Flow's MCP server for orchestrated editing.
 * This enables:
 * - Task creation for component edits
 * - Agent spawning for code modifications
 * - Memory storage for component context
 * - Status tracking across the swarm
 */

export interface ClaudeFlowState {
  connected: boolean;
  swarmActive: boolean;
  activeTaskId: string | null;
  activeAgentIds: string[];
  lastError: string | null;
}

export interface EditTask {
  taskId: string;
  componentIds: string[];
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  currentComponent: string | null;
}

export class ClaudeFlowMcp {
  private state: ClaudeFlowState = {
    connected: false,
    swarmActive: false,
    activeTaskId: null,
    activeAgentIds: [],
    lastError: null
  };
  private stateChangeListeners: ((state: ClaudeFlowState) => void)[] = [];
  private taskUpdateListeners: ((task: EditTask) => void)[] = [];
  private currentTask: EditTask | null = null;
  private statusPollInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {}

  /**
   * Initialize Claude Flow MCP connection
   */
  async initialize(_context: vscode.ExtensionContext): Promise<boolean> {
    try {
      // Check if claude-flow is available
      const { stdout } = await execAsync('npx claude-flow --version');
      console.log('CodeFlow: Claude Flow detected:', stdout.trim());

      // Check MCP server status
      const mcpStatus = await this.execMcpTool('mcp/status', {});
      this.state.connected = mcpStatus.success;

      if (this.state.connected) {
        // Start polling for status updates
        this.startStatusPolling();
      }

      this.notifyStateChange();
      return this.state.connected;
    } catch (error) {
      this.state.lastError = error instanceof Error ? error.message : 'Unknown error';
      console.error('CodeFlow: Failed to connect to Claude Flow:', this.state.lastError);
      this.notifyStateChange();
      return false;
    }
  }

  /**
   * Execute an MCP tool via claude-flow CLI
   */
  private async execMcpTool(tool: string, params: Record<string, unknown>): Promise<{ success: boolean; result?: unknown; error?: string }> {
    try {
      const paramsJson = JSON.stringify(params);
      const command = `npx claude-flow mcp exec ${tool} '${paramsJson}' --format json`;
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });

      if (stderr && stderr.includes('error')) {
        return { success: false, error: stderr };
      }

      try {
        const result = JSON.parse(stdout);
        return { success: true, result };
      } catch {
        return { success: true, result: stdout };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  /**
   * Start polling for task status updates
   */
  private startStatusPolling(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
    }

    this.statusPollInterval = setInterval(async () => {
      if (this.currentTask && this.state.activeTaskId) {
        await this.updateTaskStatus();
      }
    }, 1000);
  }

  /**
   * Update current task status from Claude Flow
   */
  private async updateTaskStatus(): Promise<void> {
    if (!this.state.activeTaskId) return;

    try {
      const result = await this.execMcpTool('task/status', { taskId: this.state.activeTaskId });
      if (result.success && result.result && this.currentTask) {
        const taskData = result.result as Record<string, unknown>;

        if (taskData.status) {
          this.currentTask.status = taskData.status as EditTask['status'];
        }
        if (taskData.progress !== undefined) {
          this.currentTask.progress = taskData.progress as number;
        }
        if (taskData.currentComponent) {
          this.currentTask.currentComponent = taskData.currentComponent as string;
        }

        this.notifyTaskUpdate();

        // If task is completed or failed, clean up
        if (this.currentTask.status === 'completed' || this.currentTask.status === 'failed') {
          this.state.activeTaskId = null;
          this.notifyStateChange();
        }
      }
    } catch (error) {
      console.error('CodeFlow: Failed to poll task status:', error);
    }
  }

  /**
   * Store component graph in Claude Flow memory
   */
  async storeComponentGraph(graph: ComponentGraph, projectName: string): Promise<boolean> {
    try {
      // Store the graph structure
      const graphResult = await this.execMcpTool('memory/store', {
        key: `codeflow:${projectName}:graph`,
        value: JSON.stringify({
          nodes: graph.nodes.map(n => ({
            id: n.id,
            name: n.name,
            type: n.type,
            filePath: n.filePath,
            line: n.line,
            exports: n.exports || []
          })),
          edges: graph.edges
        }),
        namespace: 'codeflow'
      });

      if (!graphResult.success) {
        console.error('CodeFlow: Failed to store graph:', graphResult.error);
        return false;
      }

      // Store individual component details for semantic search
      for (const node of graph.nodes.slice(0, 50)) { // Limit to first 50 to avoid overwhelming
        await this.execMcpTool('memory/store', {
          key: `codeflow:${projectName}:component:${node.id}`,
          value: JSON.stringify({
            name: node.name,
            type: node.type,
            filePath: node.filePath,
            line: node.line,
            description: `${node.type} component at ${node.filePath}:${node.line}`
          }),
          namespace: 'codeflow'
        });
      }

      console.log(`CodeFlow: Stored ${graph.nodes.length} components in Claude Flow memory`);
      return true;
    } catch (error) {
      console.error('CodeFlow: Failed to store component graph:', error);
      return false;
    }
  }

  /**
   * Create an edit task for selected components
   */
  async createEditTask(
    components: ComponentNode[],
    description: string,
    graph: ComponentGraph
  ): Promise<EditTask | null> {
    if (!this.state.connected) {
      vscode.window.showErrorMessage('CodeFlow: Not connected to Claude Flow');
      return null;
    }

    try {
      // Create the task in Claude Flow
      const taskResult = await this.execMcpTool('task/create', {
        name: `codeflow-edit-${Date.now()}`,
        description: description,
        metadata: {
          type: 'codeflow-edit',
          componentIds: components.map(c => c.id),
          componentPaths: components.map(c => c.filePath),
          componentNames: components.map(c => c.name)
        },
        priority: 'high'
      });

      if (!taskResult.success) {
        throw new Error(taskResult.error || 'Failed to create task');
      }

      const taskData = taskResult.result as Record<string, unknown>;
      const taskId = taskData.taskId as string || `task_${Date.now()}`;

      // Create local task tracking
      this.currentTask = {
        taskId,
        componentIds: components.map(c => c.id),
        description,
        status: 'pending',
        progress: 0,
        currentComponent: null
      };

      this.state.activeTaskId = taskId;
      this.notifyStateChange();
      this.notifyTaskUpdate();

      // Spawn an agent to execute the edit
      await this.spawnEditAgent(components, description, graph);

      return this.currentTask;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`CodeFlow: Failed to create edit task - ${message}`);
      return null;
    }
  }

  /**
   * Spawn a coding agent to perform the edits
   */
  private async spawnEditAgent(
    components: ComponentNode[],
    description: string,
    _graph: ComponentGraph
  ): Promise<void> {
    try {
      // Build the edit prompt with component context
      const componentList = components.map(c =>
        `- ${c.name} (${c.type}) at ${c.filePath}:${c.line}`
      ).join('\n');

      const prompt = `
Edit Task: ${description}

Components to edit:
${componentList}

Instructions:
1. Read each file to understand the current implementation
2. Make the requested changes following best practices
3. Ensure changes are consistent across all components
4. Test or validate changes if possible
5. Report progress for each component
      `.trim();

      // Spawn a coder agent
      const spawnResult = await this.execMcpTool('agent/spawn', {
        type: 'coder',
        name: `codeflow-editor-${Date.now()}`,
        task: prompt,
        config: {
          files: components.map(c => c.filePath),
          mode: 'edit',
          autoApprove: false
        }
      });

      if (spawnResult.success) {
        const agentData = spawnResult.result as Record<string, unknown>;
        const agentId = agentData.agentId as string;
        if (agentId) {
          this.state.activeAgentIds.push(agentId);
        }

        if (this.currentTask) {
          this.currentTask.status = 'in_progress';
        }

        this.notifyStateChange();
        this.notifyTaskUpdate();

        vscode.window.showInformationMessage(
          `CodeFlow: Agent spawned to edit ${components.length} components`
        );
      }
    } catch (error) {
      console.error('CodeFlow: Failed to spawn edit agent:', error);
    }
  }

  /**
   * Cancel the current edit task
   */
  async cancelEditTask(): Promise<void> {
    if (!this.state.activeTaskId || !this.currentTask) {
      return;
    }

    try {
      await this.execMcpTool('task/cancel', { taskId: this.state.activeTaskId });

      // Also terminate any active agents
      for (const agentId of this.state.activeAgentIds) {
        await this.execMcpTool('agent/terminate', { agentId });
      }

      this.currentTask.status = 'cancelled';
      this.state.activeTaskId = null;
      this.state.activeAgentIds = [];

      this.notifyStateChange();
      this.notifyTaskUpdate();

      vscode.window.showInformationMessage('CodeFlow: Edit task cancelled');
    } catch (error) {
      console.error('CodeFlow: Failed to cancel task:', error);
    }
  }

  /**
   * Update component edit status based on Claude Flow progress
   */
  async syncComponentStatus(
    graph: ComponentGraph,
    updateCallback: (nodeId: string, status: EditStatus) => void
  ): Promise<void> {
    if (!this.currentTask) return;

    // Update nodes based on current task state
    for (let i = 0; i < this.currentTask.componentIds.length; i++) {
      const componentId = this.currentTask.componentIds[i];
      const progressPercent = this.currentTask.progress / 100;
      const componentProgress = i / this.currentTask.componentIds.length;

      let status: EditStatus = 'idle';
      if (this.currentTask.currentComponent === componentId) {
        status = 'editing';
      } else if (componentProgress < progressPercent) {
        status = 'completed';
      } else if (this.currentTask.status === 'in_progress') {
        status = 'queued';
      }

      updateCallback(componentId, status);
    }
  }

  /**
   * Send a message to the Claude Flow swarm
   */
  async sendSwarmMessage(message: string, targetAgentType?: string): Promise<boolean> {
    try {
      const result = await this.execMcpTool('swarm/broadcast', {
        message,
        targetType: targetAgentType || 'all'
      });
      return result.success;
    } catch (error) {
      console.error('CodeFlow: Failed to send swarm message:', error);
      return false;
    }
  }

  /**
   * Get current state
   */
  getState(): ClaudeFlowState {
    return { ...this.state };
  }

  /**
   * Get current task
   */
  getCurrentTask(): EditTask | null {
    return this.currentTask ? { ...this.currentTask } : null;
  }

  /**
   * Register state change listener
   */
  onStateChange(listener: (state: ClaudeFlowState) => void): void {
    this.stateChangeListeners.push(listener);
  }

  /**
   * Register task update listener
   */
  onTaskUpdate(listener: (task: EditTask) => void): void {
    this.taskUpdateListeners.push(listener);
  }

  /**
   * Notify state change listeners
   */
  private notifyStateChange(): void {
    const state = this.getState();
    for (const listener of this.stateChangeListeners) {
      listener(state);
    }
  }

  /**
   * Notify task update listeners
   */
  private notifyTaskUpdate(): void {
    if (!this.currentTask) return;
    const task = this.getCurrentTask()!;
    for (const listener of this.taskUpdateListeners) {
      listener(task);
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval);
    }
    this.stateChangeListeners = [];
    this.taskUpdateListeners = [];
  }
}

// Singleton instance
let mcpInstance: ClaudeFlowMcp | null = null;

export function getClaudeFlowMcp(): ClaudeFlowMcp {
  if (!mcpInstance) {
    mcpInstance = new ClaudeFlowMcp();
  }
  return mcpInstance;
}
