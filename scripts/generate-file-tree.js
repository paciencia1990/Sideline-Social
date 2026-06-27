#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const opts = {
  root: process.cwd(),
  maxDepth: Infinity,
  json: false,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--path' || arg === '-p') {
    opts.root = path.resolve(process.cwd(), args[i + 1] ?? '.');
    i += 1;
  } else if (arg === '--depth' || arg === '-d') {
    opts.maxDepth = Number(args[i + 1]);
    i += 1;
  } else if (arg === '--json') {
    opts.json = true;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  }
}

async function getEntries(dir, depth) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const sorted = entries.sort((a, b) => a.name.localeCompare(b.name));
  return Promise.all(sorted.map(async (entry) => {
    const filePath = path.join(dir, entry.name);
    const node = {
      name: entry.name,
      path: filePath,
      type: entry.isDirectory() ? 'directory' : 'file',
    };
    if (entry.isDirectory() && depth < opts.maxDepth) {
      node.children = await getEntries(filePath, depth + 1);
    }
    return node;
  }));
}

function printTree(nodes, prefix = '') {
  const lastIndex = nodes.length - 1;
  nodes.forEach((node, index) => {
    const isLast = index === lastIndex;
    const pointer = isLast ? '└── ' : '├── ';
    console.log(prefix + pointer + node.name);
    if (node.type === 'directory' && node.children?.length) {
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      printTree(node.children, nextPrefix);
    }
  });
}

function printHelp() {
  console.log('Usage: node scripts/generate-file-tree.js [options]\n');
  console.log('Options:');
  console.log('  -p, --path <path>    Start from the specified path (default: current directory)');
  console.log('  -d, --depth <n>      Maximum depth to traverse (default: unlimited)');
  console.log('      --json           Output JSON instead of ASCII tree');
  console.log('  -h, --help           Show this help message');
}

(async () => {
  try {
    const tree = await getEntries(opts.root, 1);
    if (opts.json) {
      console.log(JSON.stringify({ path: opts.root, tree }, null, 2));
    } else {
      console.log(path.basename(opts.root) || opts.root);
      printTree(tree);
    }
  } catch (error) {
    console.error('Error generating file tree:', error.message);
    process.exit(1);
  }
})();
