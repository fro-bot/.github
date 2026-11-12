/**
 * Static rules for `splitFrontmatterBlock`'s source: no import, no regular expression, no module-level state and
 * erasable TypeScript only. They read the file from disk, so they stay outside Stryker's `testFiles`: the mutation
 * runner instruments the source with statements these rules would reject.
 */

import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import ts from 'typescript'
import {describe, expect, it} from 'vitest'

describe('the splitter module', () => {
  const path = new URL('./frontmatter-block.ts', import.meta.url)
  const source = readFileSync(path, 'utf8')
  const tree = ts.createSourceFile('frontmatter-block.ts', source, ts.ScriptTarget.Latest, true)

  function collect(kind: ts.SyntaxKind): ts.Node[] {
    const found: ts.Node[] = []
    const visit = (node: ts.Node): void => {
      if (node.kind === kind) found.push(node)
      ts.forEachChild(node, visit)
    }
    visit(tree)
    return found
  }

  it('has no import and no export-from', () => {
    expect(collect(ts.SyntaxKind.ImportDeclaration)).toHaveLength(0)
    expect(collect(ts.SyntaxKind.ImportEqualsDeclaration)).toHaveLength(0)
    expect(collect(ts.SyntaxKind.ExportDeclaration)).toHaveLength(0)
    expect(collect(ts.SyntaxKind.CallExpression).filter(call => call.getText(tree).startsWith('import('))).toHaveLength(
      0,
    )
  })

  it('has no regular expression literal and no RegExp call', () => {
    expect(collect(ts.SyntaxKind.RegularExpressionLiteral)).toHaveLength(0)
    expect(collect(ts.SyntaxKind.Identifier).filter(identifier => identifier.getText(tree) === 'RegExp')).toHaveLength(
      0,
    )
  })

  it('has no module-level constant, variable or statement that runs on import', () => {
    const kinds = tree.statements.map(statement => ts.SyntaxKind[statement.kind])
    expect(
      kinds.filter(
        kind => kind !== 'FunctionDeclaration' && kind !== 'TypeAliasDeclaration' && kind !== 'InterfaceDeclaration',
      ),
    ).toStrictEqual([])
  })

  it('uses erasable TypeScript only', () => {
    expect(() => stripTypeScriptTypes(source, {mode: 'strip'})).not.toThrow()
    expect(collect(ts.SyntaxKind.EnumDeclaration)).toHaveLength(0)
    expect(collect(ts.SyntaxKind.ModuleDeclaration)).toHaveLength(0)
    expect(
      collect(ts.SyntaxKind.Parameter).filter(
        parameter => (parameter as ts.ParameterDeclaration).modifiers !== undefined,
      ),
    ).toHaveLength(0)
  })
})
