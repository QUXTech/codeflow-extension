import * as path from 'path';
import {
  ComponentGraph,
  ComponentNode,
  ComponentEdge,
  ComponentType,
  EditStatus,
  MermaidConfig,
  RelationshipType
} from '../types';

/**
 * Default Mermaid configuration
 */
const DEFAULT_CONFIG: MermaidConfig = {
  direction: 'TB',
  theme: 'default',
  showLabels: true,
  maxNodes: 50
};

/**
 * Generate Mermaid diagram code from a component graph
 */
export function generateMermaid(
  graph: ComponentGraph,
  config: Partial<MermaidConfig> = {}
): string {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const lines: string[] = [];

  // Limit nodes if necessary
  let nodes = graph.nodes;
  let edges = graph.edges;
  
  if (nodes.length > mergedConfig.maxNodes) {
    // Prioritize nodes with more connections
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
      connectionCounts.set(edge.source, (connectionCounts.get(edge.source) || 0) + 1);
      connectionCounts.set(edge.target, (connectionCounts.get(edge.target) || 0) + 1);
    }
    
    nodes = [...nodes]
      .sort((a, b) => (connectionCounts.get(b.id) || 0) - (connectionCounts.get(a.id) || 0))
      .slice(0, mergedConfig.maxNodes);
    
    const nodeIds = new Set(nodes.map(n => n.id));
    edges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
  }

  // Start flowchart
  lines.push(`flowchart ${mergedConfig.direction}`);
  lines.push('');

  // Group nodes by type for subgraphs
  const nodesByType = groupNodesByType(nodes);

  // Add subgraphs for each type
  for (const [type, typeNodes] of nodesByType.entries()) {
    if (typeNodes.length > 0) {
      const subgraphName = getSubgraphName(type);
      lines.push(`  subgraph ${subgraphName}`);
      
      for (const node of typeNodes) {
        lines.push(`    ${formatNode(node, graph.rootPath)}`);
      }
      
      lines.push('  end');
      lines.push('');
    }
  }

  // Add edges
  lines.push('  %% Relationships');
  for (const edge of edges) {
    lines.push(`  ${formatEdge(edge, mergedConfig.showLabels)}`);
  }

  // Add click handlers for navigation
  lines.push('');
  lines.push('  %% Click handlers');
  for (const node of nodes) {
    const relativePath = path.relative(graph.rootPath, node.filePath);
    lines.push(`  click ${sanitizeId(node.id)} "vscode://file/${node.filePath}:${node.line}" "${relativePath}"`);
  }

  // Add styling based on edit status
  lines.push('');
  lines.push('  %% Styling');
  lines.push(generateStyles(nodes));

  return lines.join('\n');
}

/**
 * Generate Mermaid code for a focused view around a single node
 */
export function generateFocusedMermaid(
  graph: ComponentGraph,
  focusNodeId: string,
  depth: number = 2
): string {
  // Find all nodes within depth
  const visited = new Set<string>();
  const queue: { id: string; d: number }[] = [{ id: focusNodeId, d: 0 }];
  
  while (queue.length > 0) {
    const { id, d } = queue.shift()!;
    if (visited.has(id) || d > depth) {continue;}
    visited.add(id);
    
    for (const edge of graph.edges) {
      if (edge.source === id) {queue.push({ id: edge.target, d: d + 1 });}
      if (edge.target === id) {queue.push({ id: edge.source, d: d + 1 });}
    }
  }

  const filteredGraph: ComponentGraph = {
    nodes: graph.nodes.filter(n => visited.has(n.id)),
    edges: graph.edges.filter(e => visited.has(e.source) && visited.has(e.target)),
    rootPath: graph.rootPath,
    generatedAt: graph.generatedAt,
    languages: graph.languages
  };

  return generateMermaid(filteredGraph);
}

/**
 * Group nodes by their component type
 */
function groupNodesByType(nodes: ComponentNode[]): Map<ComponentType, ComponentNode[]> {
  const groups = new Map<ComponentType, ComponentNode[]>();
  
  for (const node of nodes) {
    const existing = groups.get(node.type) || [];
    existing.push(node);
    groups.set(node.type, existing);
  }
  
  return groups;
}

/**
 * Get human-readable subgraph name for a component type
 */
function getSubgraphName(type: ComponentType): string {
  const names: Record<ComponentType, string> = {
    component: 'Components',
    class: 'Classes',
    function: 'Functions',
    module: 'Modules',
    service: 'Services',
    hook: 'Hooks',
    context: 'Context',
    store: 'State',
    api: 'API',
    util: 'Utilities',
    type: 'Types',
    config: 'Config',
    unknown: 'Other'
  };
  
  return names[type] || 'Other';
}

/**
 * Format a node for Mermaid syntax
 */
function formatNode(node: ComponentNode, _rootPath: string): string {
  const id = sanitizeId(node.id);
  const label = node.name;
  const shape = getNodeShape(node.type);
  const statusIcon = getStatusIcon(node.editStatus);
  
  const displayLabel = statusIcon ? `${statusIcon} ${label}` : label;
  
  return `${id}${shape.open}"${displayLabel}"${shape.close}`;
}

/**
 * Get Mermaid shape brackets for a component type
 */
function getNodeShape(type: ComponentType): { open: string; close: string } {
  switch (type) {
    case 'component':
      return { open: '[', close: ']' }; // Rectangle
    case 'hook':
    case 'function':
      return { open: '([', close: '])' }; // Stadium
    case 'service':
    case 'api':
      return { open: '[[', close: ']]' }; // Subroutine
    case 'context':
    case 'store':
      return { open: '[(', close: ')]' }; // Cylinder
    case 'class':
      return { open: '[/', close: '/]' }; // Parallelogram
    case 'type':
    case 'config':
      return { open: '{{', close: '}}' }; // Hexagon
    case 'util':
      return { open: '(', close: ')' }; // Circle
    default:
      return { open: '[', close: ']' };
  }
}

/**
 * Get status icon for edit status
 */
function getStatusIcon(status: EditStatus): string {
  switch (status) {
    case 'queued':
      return '⏳';
    case 'editing':
      return '✏️';
    case 'completed':
      return '✅';
    case 'error':
      return '❌';
    case 'skipped':
      return '⏭️';
    case 'manual':
      return '👤';
    default:
      return '';
  }
}

/**
 * Format an edge for Mermaid syntax
 */
function formatEdge(edge: ComponentEdge, showLabels: boolean): string {
  const source = sanitizeId(edge.source);
  const target = sanitizeId(edge.target);
  const arrow = getEdgeArrow(edge.type);
  
  if (showLabels && edge.names && edge.names.length > 0) {
    const label = edge.names.slice(0, 3).join(', ');
    const truncated = edge.names.length > 3 ? '...' : '';
    return `${source} ${arrow}|"${label}${truncated}"| ${target}`;
  }
  
  return `${source} ${arrow} ${target}`;
}

/**
 * Get Mermaid arrow style for relationship type
 */
function getEdgeArrow(type: RelationshipType): string {
  switch (type) {
    case 'imports':
      return '-->';
    case 'exports':
      return '-.->'; // Dotted
    case 'extends':
      return '===>'; // Thick
    case 'implements':
      return '-.->';  // Dotted
    case 'uses':
      return '-->';
    case 'provides':
      return 'o-->';  // Circle start
    case 'consumes':
      return '-->o';  // Circle end
    default:
      return '-->';
  }
}

/**
 * Sanitize an ID for Mermaid (remove special characters)
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Generate CSS class definitions for node styling
 */
function generateStyles(nodes: ComponentNode[]): string {
  const lines: string[] = [];
  
  // Define style classes
  lines.push('  classDef component fill:#61dafb,stroke:#333,stroke-width:2px');
  lines.push('  classDef service fill:#68d391,stroke:#333,stroke-width:2px');
  lines.push('  classDef hook fill:#f6ad55,stroke:#333,stroke-width:2px');
  lines.push('  classDef context fill:#b794f4,stroke:#333,stroke-width:2px');
  lines.push('  classDef api fill:#fc8181,stroke:#333,stroke-width:2px');
  lines.push('  classDef util fill:#90cdf4,stroke:#333,stroke-width:2px');
  lines.push('  classDef editing fill:#fef3c7,stroke:#f59e0b,stroke-width:3px');
  lines.push('  classDef completed fill:#d1fae5,stroke:#10b981,stroke-width:2px');
  lines.push('  classDef error fill:#fee2e2,stroke:#ef4444,stroke-width:2px');
  lines.push('  classDef queued fill:#e5e7eb,stroke:#6b7280,stroke-width:2px,stroke-dasharray: 5 5');
  
  // Apply classes to nodes
  const componentNodes = nodes.filter(n => n.type === 'component').map(n => sanitizeId(n.id));
  const serviceNodes = nodes.filter(n => n.type === 'service').map(n => sanitizeId(n.id));
  const hookNodes = nodes.filter(n => n.type === 'hook').map(n => sanitizeId(n.id));
  const contextNodes = nodes.filter(n => n.type === 'context' || n.type === 'store').map(n => sanitizeId(n.id));
  const apiNodes = nodes.filter(n => n.type === 'api').map(n => sanitizeId(n.id));
  const utilNodes = nodes.filter(n => n.type === 'util').map(n => sanitizeId(n.id));
  
  if (componentNodes.length) {lines.push(`  class ${componentNodes.join(',')} component`);}
  if (serviceNodes.length) {lines.push(`  class ${serviceNodes.join(',')} service`);}
  if (hookNodes.length) {lines.push(`  class ${hookNodes.join(',')} hook`);}
  if (contextNodes.length) {lines.push(`  class ${contextNodes.join(',')} context`);}
  if (apiNodes.length) {lines.push(`  class ${apiNodes.join(',')} api`);}
  if (utilNodes.length) {lines.push(`  class ${utilNodes.join(',')} util`);}
  
  // Apply edit status styles (these override type styles)
  const editingNodes = nodes.filter(n => n.editStatus === 'editing').map(n => sanitizeId(n.id));
  const completedNodes = nodes.filter(n => n.editStatus === 'completed').map(n => sanitizeId(n.id));
  const errorNodes = nodes.filter(n => n.editStatus === 'error').map(n => sanitizeId(n.id));
  const queuedNodes = nodes.filter(n => n.editStatus === 'queued').map(n => sanitizeId(n.id));
  
  if (editingNodes.length) {lines.push(`  class ${editingNodes.join(',')} editing`);}
  if (completedNodes.length) {lines.push(`  class ${completedNodes.join(',')} completed`);}
  if (errorNodes.length) {lines.push(`  class ${errorNodes.join(',')} error`);}
  if (queuedNodes.length) {lines.push(`  class ${queuedNodes.join(',')} queued`);}
  
  return lines.join('\n');
}

/**
 * Export graph to Mermaid markdown file content
 */
export function exportToMarkdown(graph: ComponentGraph, title: string = 'Component Map'): string {
  const mermaidCode = generateMermaid(graph);
  
  return `# ${title}

Generated: ${new Date(graph.generatedAt).toLocaleString()}

## Component Diagram

\`\`\`mermaid
${mermaidCode}
\`\`\`

## Statistics

- **Total Components**: ${graph.nodes.length}
- **Total Relationships**: ${graph.edges.length}
- **Languages**: ${graph.languages.join(', ')}

## Components by Type

${Array.from(groupNodesByType(graph.nodes).entries())
  .map(([type, nodes]) => `- **${getSubgraphName(type)}**: ${nodes.length}`)
  .join('\n')}
`;
}
