import { AST_NODE_TYPES as ANT, TSESTree } from '@typescript-eslint/utils'
import { createRule } from '../utils/create-rule.js'

type FunctionNode =
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression

type WrapScope = {
  upper: WrapScope | null
  fn: FunctionNode
  callee: TSESTree.Identifier
  typeParameters: TSESTree.TSTypeParameterInstantiation | undefined
  inFn: boolean
  unwrappedFns: Map<string, TSESTree.CallExpression>
  wrappedFns: Map<string, TSESTree.TSTypeQuery>
}

export default createRule({
  name: 'consistent-unwrap',
  meta: {
    type: 'problem',
    fixable: 'code',
    docs: {
      description:
        'wrapped functions must specify the types of functions being unwrapped',
      recommended: 'error',
      requiresTypeChecking: true,
    },
    messages: {
      badWrap: 'specify all the types of functions being unwrapped',
      badUnwrap: 'this unwrapped function must be specified on the wrap type parameters',
      missingTypeParamInWrap: 'the wrap function must specify one type parameter with an union of types of the functions being unwrapped',
      badUnwrapArg: 'unwrap argument must be a call expression',
      badWrapTypeArg: 'wrap type parameter must be an union of typeof functionName of every function being unwrapped',
      duplicatedWrapArg: 'You only need to specify wrap parameters once.',
      unwrapNotInWrap: 'You must add this function type to wrap type parameter',
      wrappedFnNotUnwrapped: 'You are not unwrapping this function',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          wrapName: {
            type: 'string',
            description: 'The name you are using to import wrap. (wrap by default)',
            default: 'wrap',
          },
          unwrapName: {
            type: 'string',
            description: 'The name you are using to import unwrap. (unwrap by default)',
            default: 'unwrap',
          },
        },
      },
    ],
  },
  defaultOptions: [{
    wrapName: 'wrap',
    unwrapName: 'unwrap',
  }],
  create (context, [{ wrapName, unwrapName }]) {
    let wrappedScope: WrapScope | null = null

    function onWrapCall (node: TSESTree.CallExpression) {
      const { callee, typeParameters } = node

      if (!(callee.type === ANT.Identifier && callee.name === wrapName)) {
        return
      }
      if (!node.parent) return
      if (node.parent.type !== ANT.CallExpression) return
      if (node.parent.arguments.length !== 1) return

      const fn = node.parent.arguments[0]
      if (!(
        fn.type === ANT.FunctionExpression
        || fn.type === ANT.ArrowFunctionExpression
      )) return
      if (!fn.async) return

      wrappedScope = {
        upper: wrappedScope,
        fn,
        inFn: false,
        callee,
        typeParameters,
        unwrappedFns: new Map(),
        wrappedFns: new Map(),
      }
    }

    function enterFunction (fn: FunctionNode) {
      if (!wrappedScope || wrappedScope.fn !== fn) return
      wrappedScope.inFn = true
    }
    function onUnwrapCall (node: TSESTree.CallExpression) {
      if (!wrappedScope || !wrappedScope.inFn) return

      const { callee } = node
      if (!(callee.type === ANT.Identifier && callee.name === unwrapName)) {
        return
      }
      if (node.arguments.length !== 1) return

      const [arg] = node.arguments
      const callExpr = arg.type === ANT.AwaitExpression
        ? arg.argument
        : arg

      if (
        callExpr.type !== ANT.CallExpression
        || callExpr.callee.type !== ANT.Identifier
      ) {
        context.report({ messageId: 'badUnwrapArg', node })
        return
      }

      wrappedScope.unwrappedFns.set(callExpr.callee.name, callExpr)
    }

    function exitFunction (fn: FunctionNode) {
      if (!wrappedScope || wrappedScope.fn !== fn) return

      const { typeParameters, callee, unwrappedFns, wrappedFns } = wrappedScope

      const fixStrategy = !typeParameters
        ? ['after', callee] as const
        : ['replace', typeParameters] as const
      let needFix = false

      if (!typeParameters || typeParameters.params.length !== 1) {
        context.report({
          messageId: 'missingTypeParamInWrap',
          node: callee,
        })
        needFix = true
      } else {
        const param = typeParameters.params[0]
        const types = param.type === ANT.TSUnionType
          ? param.types
          : [param]

        types.forEach((tnode) => {
          if (
            tnode.type !== ANT.TSTypeQuery
            || tnode.exprName.type !== ANT.Identifier
          ) {
            context.report({
              node: tnode,
              messageId: 'badWrapTypeArg',
            })
            needFix = true
          } else if (wrappedFns.has(tnode.exprName.name)) {
            context.report({
              node: tnode,
              messageId: 'duplicatedWrapArg',
            })
            needFix = true
          } else {
            wrappedFns.set(tnode.exprName.name, tnode)
          }
        })
      }

      unwrappedFns.forEach((node, fnName) => {
        if (!wrappedFns.has(fnName)) {
          context.report({ messageId: 'unwrapNotInWrap', node })
          needFix = true
        }
      })

      wrappedFns.forEach((node, fnName) => {
        if (!unwrappedFns.has(fnName)) {
          context.report({ messageId: 'wrappedFnNotUnwrapped', node })
          needFix = true
        }
      })

      if (needFix) {
        context.report({
          messageId: 'badWrap',
          node: callee,
          fix: (fixer) => {
            const fixed = [...unwrappedFns.keys()].map((fn) => `typeof ${fn}`).join(' | ')
            return fixStrategy[0] === 'after'
              ? fixer.insertTextAfter(fixStrategy[1], `<${fixed}>`)
              : fixer.replaceText(fixStrategy[1], `<${fixed}>`)
          },
        })
      }

      wrappedScope = wrappedScope?.upper || null
    }

    return {
      CallExpression (node) {
        onWrapCall(node)
        onUnwrapCall(node)
      },

      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,

      'FunctionExpression:exit': exitFunction,
      'ArrowFunctionExpression:exit': exitFunction,

    }
  },
})
