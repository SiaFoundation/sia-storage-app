// @types/estree provides ESTree AST types used by ESLint-compatible plugins.
// oxlint/plugins-dev has Rule/Context types but only exports RuleTester,
// and its Context type uses complex generics that don't align cleanly with
// the simple report() signature we need. JSX node types aren't in ESTree.
import type { CallExpression, Expression, Node as ESTreeNode } from 'estree'

// ESLint/oxlint extends nodes with parent refs and adds JSX types not in ESTree
type ASTNode = (ESTreeNode | JSXNode) & { parent?: ASTNode }

interface JSXNode {
  type: 'JSXExpressionContainer' | 'JSXElement' | 'JSXFragment' | 'JSXAttribute'
  expression?: Expression
  name?: { name?: string }
}

interface RuleContext {
  report(descriptor: { node: ASTNode; messageId: string; data: Record<string, string> }): void
}

interface Rule {
  meta: {
    type: string
    docs: { description: string }
    messages: Record<string, string>
    schema: unknown[]
  }
  create(context: RuleContext): Record<string, (node: ASTNode) => void>
}

interface Plugin {
  meta: { name: string }
  rules: Record<string, Rule>
}

const NUMERIC_ID_PATTERN = /(?:count|total|num|amount|size)$/i
const NUMERIC_PROPS = new Set([
  'length',
  'count',
  'total',
  'size',
  'num',
  'amount',
  'downloadable',
  'uploadable',
])
const NUMERIC_PROP_SUFFIX = /(?:Count|Total|Size|Num|Amount)$/
const TEXT_ATTRS = new Set(['title', 'subtitle', 'label', 'placeholder', 'message', 'description'])
const FORMATTER_METHODS = new Set(['toLocaleString', 'toFixed'])
const FORMATTER_FN_PATTERN = /^(?:humanSize|format)/i
const DISPLAY_CALLS = new Set(['toast.show', 'Alert.alert'])

function isNumeric(node: Expression): boolean {
  switch (node.type) {
    case 'Identifier':
      return NUMERIC_ID_PATTERN.test(node.name)
    case 'MemberExpression': {
      const p = node.property
      if (p.type !== 'Identifier') return false
      return NUMERIC_PROPS.has(p.name) || NUMERIC_PROP_SUFFIX.test(p.name)
    }
    case 'ChainExpression':
      return node.expression.type === 'MemberExpression'
        ? isNumeric(node.expression as Expression)
        : false
    case 'Literal':
      return typeof node.value === 'number'
    case 'BinaryExpression':
      return (
        '+-*/%'.includes(node.operator) &&
        (isNumeric(node.left as Expression) || isNumeric(node.right as Expression))
      )
    case 'UnaryExpression':
      return node.operator === '+' || node.operator === '-'
    default:
      return false
  }
}

function isFormatted(node: Expression): boolean {
  if (node.type !== 'CallExpression') return false
  const c = node.callee
  if (
    c.type === 'MemberExpression' &&
    c.property.type === 'Identifier' &&
    FORMATTER_METHODS.has(c.property.name)
  )
    return true
  if (c.type === 'Identifier' && FORMATTER_FN_PATTERN.test(c.name)) return true
  return false
}

function exprName(node: Expression): string {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'ChainExpression' && node.expression.type === 'MemberExpression')
    return exprName(node.expression as Expression)
  if (node.type === 'MemberExpression') {
    const obj = exprName(node.object as Expression)
    const prop = node.property.type === 'Identifier' ? node.property.name : '?'
    return obj ? `${obj}.${prop}` : prop
  }
  return 'expression'
}

function check(node: Expression, context: RuleContext): void {
  if (isFormatted(node)) return
  if (isNumeric(node)) {
    context.report({
      node: node as ASTNode,
      messageId: 'unformatted',
      data: { expression: exprName(node) },
    })
    return
  }
  switch (node.type) {
    case 'TemplateLiteral':
      for (const expr of node.expressions) check(expr as Expression, context)
      break
    case 'ConditionalExpression':
      check(node.consequent, context)
      check(node.alternate, context)
      break
    case 'LogicalExpression':
      if (node.operator === '&&') {
        check(node.right, context)
      } else if (node.operator === '??' || node.operator === '||') {
        check(node.left, context)
        if (node.right.type !== 'Literal') check(node.right, context)
      }
      break
    case 'ChainExpression':
      check(node.expression as Expression, context)
      break
  }
}

function calleeMatchesDisplay(node: Expression): boolean {
  if (node.type !== 'MemberExpression') return false
  const obj = node.object
  const prop = node.property
  if (obj.type !== 'Identifier' || prop.type !== 'Identifier') return false
  return DISPLAY_CALLS.has(`${obj.name}.${prop.name}`)
}

const rule: Rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require locale formatting when displaying numbers in JSX and display functions',
    },
    messages: {
      unformatted: '"{{expression}}" should be formatted for display (e.g. .toLocaleString()).',
    },
    schema: [],
  },
  create(context: RuleContext) {
    return {
      JSXExpressionContainer(node: ASTNode) {
        const parent = node.parent
        if (!parent) return

        let display = false
        if (parent.type === 'JSXElement' || parent.type === 'JSXFragment') {
          display = true
        } else if (parent.type === 'JSXAttribute') {
          const name = (parent as JSXNode).name?.name
          if (name && TEXT_ATTRS.has(name)) display = true
        }

        if (display) check((node as JSXNode).expression!, context)
      },
      CallExpression(node: ASTNode) {
        const call = node as unknown as CallExpression
        if (!calleeMatchesDisplay(call.callee as Expression)) return
        for (const arg of call.arguments) {
          check(arg as Expression, context)
        }
      },
    }
  },
}

const plugin: Plugin = {
  meta: { name: 'custom' },
  rules: { 'no-unformatted-display-number': rule },
}

export default plugin
