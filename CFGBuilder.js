'use strict';
const {Block,NormalCompletion} = require('./Block');
class CFGBuilder {
  constructor(root = new Block, exit = new Block) {
    this.root = root;
    this.exit = exit;
    this.currentBlock = this.root;
    this.nodeLabels = new WeakMap;
    this.labelCompletions = new Map;
    this.loopCompletions = new WeakMap;
    this.joinBlocks = new WeakMap;
    this.handled = new Set;
    this.unhandled = new Set;
    this.unreachable = new Map;
  }
  disposePath(path) {
    this.disposeJoin(path);
    this.disposeLoop(path);
    this.disposeLabel(path);
  }

  disposeLabel(path) {
    if (this.nodeLabels.has(path.node)) {
      const name = this.nodeLabels.get(path.node);
      
      // never erase name from node
      // NODE_LABELS.delete(path.node);

      // free up label identifier
      this.labelCompletions.delete(name);
    }
  } 

  disposeLoop(path) {
    if (this.loopCompletions.has(path.node)) {
      this.loopCompletions.delete(path.node);
    }
  }

  disposeJoin(path) {
    if (this.joinBlocks.has(path.node) && !this.currentBlock.completion) {
      const exit = this.joinBlocks.get(path.node);
      this.currentBlock.completion = new NormalCompletion(exit);
      this.currentBlock = exit;
    }
  }

  setLabel(name, node, completion) {
    name = `${name}`;
    if (this.labelCompletions.has(name)) {
      throw 'Already has name';
    }
    if (this.nodeLabels.has(node)) {
      throw 'Already has node';
    }
    this.labelCompletions.set(name, completion);
    this.nodeLabels.set(node, name);
  }
  
  getLabel(path) {
    return this.nodeLabels.get(path.node);
  }

  getLabelCompletion(name) {
    return this.labelCompletions.get(name);
  }

  getParentLoopCompletion(path) {
    while (path && !this.loopCompletions.has(path.node)) {
      path = path.parentPath;
    }
    if (path) {
      return this.loopCompletions.get(path.node);
    }
  }

  setLoop(path, completion) {
    this.loopCompletions.set(path.node, completion);
  }

  setJoin(path, exit) {
    if (this.joinBlocks.has(path.node)) {
      throw 'Already has node';
    }
    this.joinBlocks.set(path.node, exit);
  }

  parentJoin(path) {
    const original = path;
    path = path.parentPath;
    while (path && !this.joinBlocks.has(path.node)) {
      path = path.parentPath;
    }
    if (path) {
      return this.joinBlocks.get(path.node);
    }
    else {
      return this.exit;
    }
  }

  setHandled(path) {
    this.handled.add(path.node);
    if (this.unhandled.has(path.node)) {
      this.unhandled.delete(path.node);
    }    
  }

  setUnhandled(path) {
    if (!this.handled.has(path.node)) {
      this.unhandled.add(path.node);
    }
  }

  addUnreachable(completedBlock, unreachableBlock) {
    this.unreachable.set(completedBlock, unreachableBlock);
  }
}
module.exports = CFGBuilder;