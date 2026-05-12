export default {
  rules: {
    'no-tooling-imports-in-production': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Prevent @tooling imports from leaking into production code.',
        },
        messages: {
          restricted: '@tooling imports are only allowed in test files.',
        },
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            const source = node.source.value;
            if (source === '@tooling' || source.startsWith('@tooling/')) {
              context.report({ node: node.source, messageId: 'restricted' });
            }
          },
        };
      },
    },
  },
};
