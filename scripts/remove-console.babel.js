module.exports = function removeConsole({ types: t }) {
  return {
    name: "remove-production-console",
    visitor: {
      CallExpression(path) {
        const callee = path.node.callee;
        if (
          t.isMemberExpression(callee) &&
          t.isIdentifier(callee.object, { name: "console" })
        ) {
          path.replaceWith(t.unaryExpression("void", t.numericLiteral(0)));
        }
      },
    },
  };
};
