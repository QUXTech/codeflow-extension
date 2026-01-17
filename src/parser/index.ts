import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ParseResult, SupportedLanguage } from '../types';
import { parseTypeScript } from './typescript';
import { parsePython } from './python';
import { parseCSharp } from './csharp';

/**
 * Parse the entire workspace and return results for all files
 */
export async function parseWorkspace(
  rootPath: string,
  excludePatterns: string[],
  cancellationToken?: vscode.CancellationToken
): Promise<ParseResult[]> {
  const results: ParseResult[] = [];

  // Find all relevant files
  const patterns = [
    '**/*.ts',
    '**/*.tsx',
    '**/*.js',
    '**/*.jsx',
    '**/*.py',
    '**/*.cs'
  ];

  const ignorePatterns = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/venv/**',
    '**/__pycache__/**',
    '**/bin/**',
    '**/obj/**',
    ...excludePatterns
  ];

  for (const pattern of patterns) {
    if (cancellationToken?.isCancellationRequested) {
      break;
    }

    try {
      const files = await glob(pattern, {
        cwd: rootPath,
        ignore: ignorePatterns,
        absolute: true,
        nodir: true
      });

      for (const filePath of files) {
        if (cancellationToken?.isCancellationRequested) {
          break;
        }

        try {
          const result = await parseFile(filePath);
          if (result.components.length > 0 || result.imports.length > 0) {
            results.push(result);
          }
        } catch (error) {
          console.error(`CodeFlow: Error parsing ${filePath}:`, error);
          results.push({
            filePath,
            components: [],
            imports: [],
            errors: [error instanceof Error ? error.message : 'Unknown error']
          });
        }
      }
    } catch (error) {
      console.error(`CodeFlow: Error finding files with pattern ${pattern}:`, error);
    }
  }

  return results;
}

/**
 * Parse a single file based on its extension
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
  const ext = path.extname(filePath).toLowerCase();
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const language = getLanguageFromExtension(ext);

  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'react':
      return parseTypeScript(filePath, content, language);
    case 'python':
      return parsePython(filePath, content);
    case 'csharp':
      return parseCSharp(filePath, content);
    default:
      return {
        filePath,
        components: [],
        imports: [],
        errors: [`Unsupported file type: ${ext}`]
      };
  }
}

/**
 * Determine the language from file extension
 */
function getLanguageFromExtension(ext: string): SupportedLanguage {
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'react';
    case '.js':
      return 'javascript';
    case '.jsx':
      return 'react';
    case '.py':
      return 'python';
    case '.cs':
      return 'csharp';
    default:
      return 'typescript'; // Default fallback
  }
}
