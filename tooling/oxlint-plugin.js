const TOOLING_IMPORT_MESSAGE = '@tooling imports are only allowed in test files.';

function isToolingImport(value) {
  return value === '@tooling' || value.startsWith('@tooling/');
}

function checkSource(context, node) {
  const source = node.source?.value;
  if (typeof source !== 'string' || !isToolingImport(source)) return;

  context.report({
    node,
    message: TOOLING_IMPORT_MESSAGE,
  });
}

export default {
  meta: {
    name: 'emdash',
  },
  rules: {
    'no-tooling-imports': {
      meta: {
        type: 'problem',
        messages: {
          restricted: TOOLING_IMPORT_MESSAGE,
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            checkSource(context, node);
          },
          ExportNamedDeclaration(node) {
            checkSource(context, node);
          },
          ExportAllDeclaration(node) {
            checkSource(context, node);
          },
        };
      },
    },
  },
};
