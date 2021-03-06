
const src = require('fs').readFileSync(process.argv[2]).toString();

const ast = require('babylon').parse(src, {
  sourceFilename: 'tempfile'
});
const t = require('babel-types');
const traverse = require('babel-traverse').default
const Scope = require('babel-traverse').Scope;
const {
  Block,
  NormalCompletion,
  MarkerCompletion,
  BranchCompletion,
  BreakCompletion,
  ContinueCompletion,
} = require('./Block/block');
const CFGBuilder = require('./CFGBuilder');
const makeBlock = (path, loc = 'start', prefix = '') => {
  const block = new Block;
  block.name = `${prefix}${path.node.loc.filename || ''}_${path.node.loc[loc].line}_${path.node.loc[loc].column}`;
  return block;
}
const inExpressionPosition = (path) => {
  const parentPath = path.parentPath;
  if (parentPath.isExpression()) return true;
  if (parentPath.isExpressionStatement()) return true;
  if (parentPath.isProgram()) return true;
  if (parentPath.isBlockStatement()) return true;
  if (parentPath.isIfStatement() && path.node === parentPath.node.test) return true;
  return false;
}
const builder = new CFGBuilder(
  Object.assign(new Block, {name: 'root'}),
  Object.assign(new Block, {name: 'end'})
);
const subtraversal = (path) => {
  traverse(
    t.file(
    Object.assign(t.program([
      path.isStatement() ?
        path.node :
        Object.assign(t.expressionStatement(path.node), {loc:path.node.loc})
    ]), {loc:path.node.loc})
    ),
    handlers,
    path.scope,
    path.state,
    path
  );
}
const BLOCK_STACK = [];
const handlers = {
  LabeledStatement: {
    enter(path) {
      path.skipKey('label');
    }
  },
  Program: {
    enter(path) {
      const entryBlock = makeBlock(path);
      const programBlock = builder.currentBlock;
      programBlock.setCompletion(
        new MarkerCompletion(programBlock, entryBlock)
      );
      builder.currentBlock = entryBlock;
      builder.setHandled(path);
    },
    exit(path) {
      const programJoinBlock = builder.currentBlock;
      programJoinBlock.setCompletion(
        new NormalCompletion(programJoinBlock, builder.exit)
      );
    }
  },
  WhileStatement: {
    enter(path) {
      path.skipKey('test');
      path.skipKey('body');
      const whileBlock = builder.currentBlock;
      const testBlock = makeBlock(path, 'start', 'while_test_');
      const joinBlock = makeBlock(path, 'end', 'while_join_');
      whileBlock.setCompletion(new MarkerCompletion(whileBlock, testBlock));
      builder.currentBlock = testBlock;
      const test = path.get('test');
      subtraversal(test);
      const testJoinBlock = builder.currentBlock;
      const whileBodyBlock = makeBlock(test, 'end', 'while_body_');
      testJoinBlock.setCompletion(new BranchCompletion(testJoinBlock, whileBodyBlock, joinBlock));
      if (path.parentPath.isLabeledStatement()) {
        builder.setHandled(path.parentPath);
        const name = path.parent.label.name;
        builder.setLabel(name, path.node, whileBlock.completion);
      }
      builder.setLoop(path, {
        enter: testBlock,
        exit: joinBlock,
      });
      builder.currentBlock = whileBodyBlock;
      subtraversal(path.get('body'));
      const bodyJoinBlock = builder.currentBlock;
      bodyJoinBlock.setCompletion(new NormalCompletion(bodyJoinBlock, testBlock));
      builder.currentBlock = joinBlock;
    }
  },
  IfStatement: {
    enter(path) {
      // YOLO
      subtraversal(path.get('test'));
      path.skipKey('test');
      const consequent = path.get('consequent');
      const alternate = path.node.alternate ? path.get('alternate') : null;
      const consequentBlock = makeBlock(consequent, 'start', 'truthy_');
      const forkBlock = builder.currentBlock;
      builder.currentBlock = consequentBlock;
      subtraversal(consequent);
      path.skipKey('consequent');
      // always join from Block
      const join = builder.currentBlock;
      if (alternate) {
        const alternateBlock = makeBlock(alternate, 'end', 'falsey_');
        builder.currentBlock = alternateBlock;
        subtraversal(alternate);
        path.skipKey('alternate');
        // always NormalCompletion
        const alternateJoinBlock = builder.currentBlock;
        alternateJoinBlock.setCompletion(new NormalCompletion(alternateJoinBlock, join));
        forkBlock.setCompletion(new BranchCompletion(forkBlock, consequentBlock, alternateBlock));
        builder.currentBlock = join;
      }
      else {
        forkBlock.setCompletion(new BranchCompletion(forkBlock, consequentBlock, join));
        builder.currentBlock = join;
      }
      builder.setHandled(path);
      builder.currentBlock = join;
    }
  },
  EmptyStatement: {
    enter(path) {
      builder.setHandled(path);
    },
  },
  BlockStatement: {
    enter(path) {
      builder.setHandled(path);
      const bodyBlock = makeBlock(path, 'start');
      const joinBlock = makeBlock(path, 'end');
      BLOCK_STACK.push({exit: joinBlock});
      if (path.parentPath.isLabeledStatement()) {
        builder.setHandled(path.parentPath);
        const name = path.parent.label.name;
        const completion = {exit: joinBlock};
        builder.setLabel(name, path.node, completion);
        const labelBlock = builder.currentBlock;
        labelBlock.setCompletion(new MarkerCompletion(labelBlock, bodyBlock));
        builder.currentBlock = bodyBlock;
      }
    },
    exit(path) {
      const {exit} = BLOCK_STACK.pop();
      const bodyBlock = builder.currentBlock;
      bodyBlock.setCompletion(new NormalCompletion(bodyBlock, exit));
      builder.currentBlock = exit;
    }
  },
  MemberExpression: {
    exit(path) {
      builder.setHandled(path);
      builder.currentBlock.steps.add({
        type: path.node.type,
        dump: `${path.node.type} []`
      });
    }
  },
  ExpressionStatement: {
    enter(path) {
      builder.setHandled(path);
    }
  },
  RegExpLiteral: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          raw: path.node.extra.raw,
          dump: `${path.node.type} ${path.node.extra.raw}`
        });
      }
    }
  },
  NumericLiteral: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          raw: path.node.extra.raw,
          dump: `${path.node.type} ${path.node.extra.raw}`
        });
      }
    }
  },
  BooleanLiteral: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          value: path.node.value,
          dump: `${path.node.type} ${path.node.value}`,
        });
      }
    }
  },
  StringLiteral: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          raw: path.node.extra.raw,
          dump: `${path.node.type} ${path.node.extra.raw}`,
        });
      }
    }
  },
  NullLiteral: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          dump: `${path.node.type} null`
        });
      }
    }
  },
  UnaryExpression: {
    exit(path) {
      builder.setHandled(path);
      builder.currentBlock.steps.add({
        type: path.node.type,
        operator: path.node.operator,
        dump: `${path.node.type} ${path.node.operator}`.replace(/\W/g, '\\$&'),
      });
    }
  },
  BinaryExpression: {
    exit(path) {
      builder.setHandled(path);
      builder.currentBlock.steps.add({
        type: path.node.type,
        operator: path.node.operator,
        dump: `${path.node.type} ${path.node.operator}`.replace(/\W/g, '\\$&'),
      });
    }
  },
  LogicalExpression: {
    exit(path) {
      builder.setHandled(path);
      builder.currentBlock.steps.add({
        type: path.node.type,
        operator: path.node.operator,
        dump: `${path.node.type} ${path.node.operator}`.replace(/\W/g, '\\$&'),
      });
    }
  },
  Identifier: {
    exit(path) {
      if (inExpressionPosition(path)) {
        builder.setHandled(path);
        builder.currentBlock.steps.add({
          type: path.node.type,
          name: path.node.name,
          dump: `${path.node.type} ${path.node.name}`
        });
      }
    }
  },
  BreakStatement(path) {
    builder.setHandled(path);
    let next;
    if (path.node.label !== null) {
      path.skipKey('label');
      const name = path.node.label.name;
      const completion = builder.getLabelCompletion(name);
      if (!completion) {
        throw `unknown label ${name}`;
      }
      next = completion.exit;
    }
    else {
      const completion = builder.getParentLoopCompletion(path);
      if (!completion) {
        throw `not in a loop`;
      }
      next = completion.exit;
    }
    const bodyBlock = builder.currentBlock;
    bodyBlock.setCompletion(new BreakCompletion(bodyBlock, next));
    // unreachable
    const unreachable = makeBlock(path, 'end', 'unreachable_');
    builder.addUnreachable(builder.currentBlock, unreachable);
    builder.currentBlock = unreachable;
  },
  ContinueStatement(path) {
    builder.setHandled(path);
    let next;
    if (path.node.label !== null) {
      path.skipKey('label');
      const name = path.node.label.name;
      const completion = builder.getLabelCompletion(name);
      if (!completion) {
        throw `unknown label ${name}`;
      }
      next = completion.enter;
    }
    else {
      const completion = builder.getParentLoopCompletion(path);
      if (!completion) {
        throw `not in a loop`;
      }
      next = completion.enter;
    }
    const bodyBlock = builder.currentBlock;
    bodyBlock.setCompletion(new ContinueCompletion(bodyBlock, next));
    // unreachable
    const unreachable = makeBlock(path, 'end', 'unreachable_');
    builder.addUnreachable(builder.currentBlock, unreachable);
    builder.currentBlock = unreachable;
  },
  enter(path) {
    // console.log('enter', path.node.type)
  },
  exit(path) {
    builder.setUnhandled(path);
    builder.disposePath(path);
  },
}
traverse(ast, handlers);

require('./printer/DOT').dump(builder);