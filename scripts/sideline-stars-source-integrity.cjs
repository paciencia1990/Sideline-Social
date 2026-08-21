const path = require("node:path");

const ts = require(path.join(__dirname, "../functions/node_modules/typescript"));

const DEFAULT_AUTHORIZED_REWARD_WRITERS = new Set([
  "completeWeeklyChallenge",
  "finalizeGameReward",
]);
const DEFAULT_REWARD_FLOW_HANDLERS = new Set([
  "completeWeeklyChallenge",
  "createGameRewardSession",
  "finalizeGameReward",
  "getCurrentWeeklyChallenge",
  "recordGameSessionResult",
]);
const FIRESTORE_WRITE_METHODS = new Set(["create", "set", "update"]);
const PROTECTED_REWARD_FIELDS = new Set([
  "rewardReason",
  "rewardReasons",
  "sidelineStars",
]);
const REWARD_GATE_PATTERN = /dailyGame|dailyStars|subscription|entitlement|advertisement/i;

function nodeName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isComputedPropertyName(node)
    && ts.isStringLiteralLike(node.expression)
  ) {
    return node.expression.text;
  }
  return null;
}

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function exportedHandlerName(node) {
  let current = node;
  while (current) {
    if (ts.isFunctionDeclaration(current) && hasExportModifier(current)) {
      return nodeName(current.name);
    }
    if (ts.isVariableDeclaration(current)) {
      const statement = current.parent?.parent;
      if (statement && ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        return nodeName(current.name);
      }
    }
    current = current.parent;
  }
  return null;
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
    return nodeName(node.name);
  }
  return null;
}

function collectProtectedFields(node) {
  const fields = new Set();
  function visit(current) {
    const name = propertyName(current);
    if (name && PROTECTED_REWARD_FIELDS.has(name)) fields.add(name);
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return fields;
}

function containsRewardTransactionReference(node, sourceFile, rewardReferenceNames) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (ts.isStringLiteralLike(current) && current.text === "rewardTransactions") {
      found = true;
      return;
    }
    if (ts.isIdentifier(current) && rewardReferenceNames.has(current.text)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return found;
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function mutatedPropertyName(expression) {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression)
    && expression.argumentExpression
    && ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function writeCallParts(call) {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const method = call.expression.name.text;
  if (!FIRESTORE_WRITE_METHODS.has(method)) return null;

  const receiver = call.expression.expression;
  const [firstArgument, secondArgument] = call.arguments;
  const transactionStyle = Boolean(
    secondArgument
    && ts.isObjectLiteralExpression(secondArgument)
    && firstArgument
    && !ts.isObjectLiteralExpression(firstArgument),
  );

  return {
    method,
    payload: transactionStyle ? secondArgument : firstArgument,
    target: transactionStyle ? firstArgument : receiver,
  };
}

function locationOf(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${position.line + 1}:${position.character + 1}`;
}

function collectTopLevelDeclarations(sourceFile) {
  const declarations = new Map();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = nodeName(declaration.name);
      if (name) declarations.set(name, declaration);
    }
  }
  return declarations;
}

function referencedTopLevelFunctions(node, declarations) {
  const references = new Set();
  function visit(current) {
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      if (declarations.has(current.expression.text)) references.add(current.expression.text);
    }
    ts.forEachChild(current, visit);
  }
  if (node) visit(node);
  return references;
}

function rewardFlowClosure(sourceFile, handlerNames) {
  const declarations = collectTopLevelDeclarations(sourceFile);
  const pending = [...handlerNames];
  const closure = new Map();

  while (pending.length > 0) {
    const name = pending.pop();
    if (closure.has(name)) continue;
    const declaration = declarations.get(name);
    if (!declaration) continue;
    closure.set(name, declaration);
    for (const reference of referencedTopLevelFunctions(declaration, declarations)) {
      if (!closure.has(reference)) pending.push(reference);
    }
  }

  return closure;
}

function scanSidelineStarsSource(source, options = {}) {
  const fileName = options.fileName || "functions/src/index.ts";
  const authorizedRewardWriters = new Set(
    options.authorizedRewardWriters || DEFAULT_AUTHORIZED_REWARD_WRITERS,
  );
  const rewardFlowHandlers = new Set(
    options.rewardFlowHandlers || DEFAULT_REWARD_FLOW_HANDLERS,
  );
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const rewardReferenceNames = new Set();
  const violations = [];

  function collectRewardReferences(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (containsRewardTransactionReference(node.initializer, sourceFile, new Set())) {
        rewardReferenceNames.add(node.name.text);
      }
    }
    ts.forEachChild(node, collectRewardReferences);
  }
  collectRewardReferences(sourceFile);

  function addUnauthorizedMutation(node, details) {
    const handler = exportedHandlerName(node);
    if (handler && authorizedRewardWriters.has(handler)) return;
    violations.push({
      kind: "unauthorized-reward-mutation",
      handler,
      location: locationOf(sourceFile, node),
      details,
    });
  }

  function inspectMutations(node) {
    if (ts.isCallExpression(node)) {
      const parts = writeCallParts(node);
      if (parts) {
        const fields = collectProtectedFields(parts.payload);
        const writesRewardTransaction = containsRewardTransactionReference(
          parts.target,
          sourceFile,
          rewardReferenceNames,
        );
        const stringFieldWrite = node.arguments.some(
          (argument) => ts.isStringLiteralLike(argument) && PROTECTED_REWARD_FIELDS.has(argument.text),
        );
        if (fields.size > 0 || writesRewardTransaction || stringFieldWrite) {
          const evidence = [
            ...[...fields].map((field) => `field ${field}`),
            ...(writesRewardTransaction ? ["rewardTransactions write"] : []),
            ...(stringFieldWrite ? ["string field write"] : []),
          ];
          addUnauthorizedMutation(node, evidence.join(", "));
        }
      }
    }

    if (
      ts.isBinaryExpression(node)
      && isAssignmentOperator(node.operatorToken.kind)
      && PROTECTED_REWARD_FIELDS.has(mutatedPropertyName(node.left))
    ) {
      addUnauthorizedMutation(node, `direct assignment to ${mutatedPropertyName(node.left)}`);
    }

    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)
      && PROTECTED_REWARD_FIELDS.has(mutatedPropertyName(node.operand))
    ) {
      addUnauthorizedMutation(node, `direct update of ${mutatedPropertyName(node.operand)}`);
    }

    ts.forEachChild(node, inspectMutations);
  }
  inspectMutations(sourceFile);

  for (const [name, declaration] of rewardFlowClosure(sourceFile, rewardFlowHandlers)) {
    const match = declaration.getText(sourceFile).match(REWARD_GATE_PATTERN);
    if (match) {
      violations.push({
        kind: "reward-cap-or-monetization-gate",
        handler: name,
        location: locationOf(sourceFile, declaration),
        details: `reward flow contains ${JSON.stringify(match[0])}`,
      });
    }
  }

  return violations;
}

function assertSidelineStarsSourceIntegrity(source, options = {}) {
  const violations = scanSidelineStarsSource(source, options);
  if (violations.length === 0) return;
  const details = violations.map((violation) => {
    const handler = violation.handler || "non-exported scope";
    return `${violation.location} [${handler}] ${violation.details}`;
  });
  throw new Error(`Sideline Stars source integrity violation:\n${details.join("\n")}`);
}

module.exports = {
  assertSidelineStarsSourceIntegrity,
  scanSidelineStarsSource,
};
