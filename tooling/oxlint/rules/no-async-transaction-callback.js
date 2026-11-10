// SQLite transactions in this repo (better-sqlite3, drizzle's AppDb, sqlite-store handles and the
// legacy import) are synchronous. An async callback returns at its first `await`; the transaction
// then commits or rolls back while the rest of the callback keeps writing outside it. The types
// reject inferred async callbacks, but not one whose result is forced to `void`, so lint the
// syntax too.
const TRANSACTION_FUNCTIONS = new Set(['inTransaction', 'importAtomically']);

function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return undefined;
}

function isTransactionCall(node) {
  const name = calleeName(node.callee);
  return name === 'transaction' || TRANSACTION_FUNCTIONS.has(name);
}

export const noAsyncTransactionCallbackRule = {
  meta: {
    type: 'problem',
    messages: {
      async:
        'SQLite transaction callbacks must be synchronous: after its first await an async callback runs outside the transaction. Do async work before or after the transaction.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isTransactionCall(node)) return;
        for (const argument of node.arguments) {
          const isFunction =
            argument.type === 'ArrowFunctionExpression' || argument.type === 'FunctionExpression';
          if (isFunction && argument.async) {
            context.report({ node: argument, messageId: 'async' });
          }
        }
      },
    };
  },
};
