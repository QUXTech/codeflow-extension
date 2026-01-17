/**
 * CodeFlow Types
 * Core type definitions for component graph representation
 */

/** Supported languages for parsing */
export type SupportedLanguage = 'typescript' | 'javascript' | 'react' | 'csharp' | 'python';

/** Component types that can be detected */
export type ComponentType = 
  | 'component'      // React/Vue component
  | 'class'          // Class definition
  | 'function'       // Function/method
  | 'module'         // Module/namespace
  | 'service'        // Service class (detected by naming convention)
  | 'hook'           // React hook
  | 'context'        // React context
  | 'store'          // State store (Redux, Zustand, etc.)
  | 'api'            // API layer
  | 'util'           // Utility module
  | 'type'           // Type definition file
  | 'config'         // Configuration file
  | 'unknown';

/** Relationship types between components */
export type RelationshipType =
  | 'imports'        // Direct import
  | 'exports'        // Re-exports
  | 'extends'        // Class inheritance
  | 'implements'     // Interface implementation
  | 'uses'           // Function call / instantiation
  | 'provides'       // Context provider
  | 'consumes';      // Context consumer

/** Status of a component during Claude orchestration */
export type EditStatus = 
  | 'idle'           // Not being edited
  | 'queued'         // Scheduled for editing
  | 'editing'        // Currently being edited by Claude
  | 'completed'      // Edit completed successfully
  | 'error'          // Edit failed
  | 'skipped'        // Skipped by user
  | 'manual';        // User took over manually

/** A single component node in the graph */
export interface ComponentNode {
  /** Unique identifier for the component */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Full file path */
  filePath: string;
  
  /** Line number where component is defined */
  line: number;
  
  /** Column number where component is defined */
  column: number;
  
  /** Type of component */
  type: ComponentType;
  
  /** Detected language */
  language: SupportedLanguage;
  
  /** Brief description (can be enhanced by Claude) */
  description?: string;
  
  /** Export names from this component */
  exports: string[];
  
  /** Current edit status */
  editStatus: EditStatus;
  
  /** Error message if editStatus is 'error' */
  errorMessage?: string;
  
  /** Timestamp of last modification */
  lastModified?: number;
}

/** A relationship edge between components */
export interface ComponentEdge {
  /** Source component ID */
  source: string;
  
  /** Target component ID */
  target: string;
  
  /** Type of relationship */
  type: RelationshipType;
  
  /** Specific import/export names involved */
  names?: string[];
}

/** The complete component graph */
export interface ComponentGraph {
  /** All component nodes */
  nodes: ComponentNode[];
  
  /** All relationship edges */
  edges: ComponentEdge[];
  
  /** Root directory of the project */
  rootPath: string;
  
  /** Timestamp when graph was generated */
  generatedAt: number;
  
  /** Languages detected in the project */
  languages: SupportedLanguage[];
}

/** Edit plan from Claude */
export interface EditPlan {
  /** Unique plan ID */
  id: string;
  
  /** Human-readable description of what will be changed */
  description: string;
  
  /** Ordered list of component IDs to edit */
  componentOrder: string[];
  
  /** Current index in the edit sequence */
  currentIndex: number;
  
  /** Overall plan status */
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  
  /** Timestamp when plan was created */
  createdAt: number;
}

/** Message from extension to webview */
export interface ExtensionMessage {
  type: 'graphUpdate' | 'statusUpdate' | 'editPlanUpdate' | 'error' | 'settings'
    | 'activityUpdate' | 'autoApproveUpdate' | 'undoHistoryUpdate' | 'contextFilesUpdate'
    | 'pendingDiffsUpdate' | 'sessionInfoUpdate' | 'costSummaryUpdate' | 'bookmarksUpdate';
  payload: unknown;
}

/** Message from webview to extension */
export interface WebviewMessage {
  type: 'nodeClick' | 'nodeSelect' | 'requestRefresh' | 'takeOverEdit' | 'skipComponent' | 'cancelPlan'
    | 'approveEdit' | 'denyEdit' | 'toggleAutoApprove' | 'setAutoApprove'
    | 'undoFile' | 'rollbackSession'
    | 'runPromptTemplate' | 'showPromptTemplates'
    | 'addToContext' | 'removeFromContext' | 'clearContext' | 'copyContextReferences' | 'copyContextContent'
    | 'showDiff' | 'approveDiff' | 'denyDiff'
    | 'addBookmark' | 'removeBookmark' | 'goToBookmark' | 'toggleBookmarkPin'
    | 'showSessionHistory' | 'exportSessionLog'
    | 'showCostSummary' | 'resetCostTracker';
  payload: unknown;
}

/** Mermaid diagram configuration */
export interface MermaidConfig {
  /** Diagram direction: TB (top-bottom), LR (left-right), etc. */
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  
  /** Theme for the diagram */
  theme: 'default' | 'dark' | 'forest' | 'neutral';
  
  /** Whether to show relationship labels */
  showLabels: boolean;
  
  /** Maximum nodes to display (for performance) */
  maxNodes: number;
}

/** Parser result for a single file */
export interface ParseResult {
  /** File path that was parsed */
  filePath: string;
  
  /** Components found in the file */
  components: Omit<ComponentNode, 'editStatus'>[];
  
  /** Import statements found */
  imports: {
    source: string;
    names: string[];
    isDefault: boolean;
    isNamespace: boolean;
    /** True if this is a re-export (export { X } from 'module') */
    isReexport?: boolean;
  }[];
  
  /** Any parsing errors */
  errors: string[];
}
