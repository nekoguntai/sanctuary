#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rawArgs = process.argv.slice(2).filter(Boolean);
const envArgs = (process.env.CHANGED_TEST_FILES || '')
  .split(/\s+/)
  .filter(Boolean);

const inputFiles = rawArgs.length > 0 ? rawArgs : envArgs;

if (inputFiles.length === 0) {
  console.log('test-hygiene: no test files provided, skipping.');
  process.exit(0);
}

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;
const normalizedFiles = [...new Set(
  inputFiles
    .map(file => file.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
)]
  .filter(file => TEST_FILE_RE.test(file))
  .map(file => path.normalize(file));

if (normalizedFiles.length === 0) {
  console.log('test-hygiene: no matching test files found in input, skipping.');
  process.exit(0);
}

const checks = [
  {
    kind: 'focused test',
    message: 'Remove focused test markers before merge.',
    regex: /\b(?:it|test|describe|context|suite)\.only\s*\(/,
  },
  {
    kind: 'focused test',
    message: 'Remove focused test markers before merge.',
    regex: /\b(?:fit|fdescribe)\s*\(/,
  },
  {
    kind: 'disabled test',
    message: 'Avoid disabled tests in changed files.',
    regex: /\b(?:it|test|describe|context|suite)\.skip\s*\(/,
  },
  {
    kind: 'disabled test',
    message: 'Avoid disabled tests in changed files.',
    regex: /\b(?:xit|xdescribe)\s*\(/,
  },
  {
    kind: 'weak assertion',
    message: 'Prefer explicit assertions over toBeTruthy()/toBeFalsy().',
    regex: /\.toBeTruthy\s*\(/,
  },
  {
    kind: 'weak assertion',
    message: 'Prefer explicit assertions over toBeTruthy()/toBeFalsy().',
    regex: /\.toBeFalsy\s*\(/,
  },
];

const findings = [];

for (const file of normalizedFiles) {
  if (!fs.existsSync(file)) {
    continue;
  }

  const contents = fs.readFileSync(file, 'utf8');
  const lines = contents.split('\n');

  lines.forEach((line, index) => {
    if (line.includes('hygiene-ignore')) {
      return;
    }

    checks.forEach(check => {
      if (check.regex.test(line)) {
        findings.push({
          file,
          line: index + 1,
          kind: check.kind,
          message: check.message,
          snippet: line.trim(),
        });
      }
    });
  });
}

if (findings.length === 0) {
  console.log(`test-hygiene: passed (${normalizedFiles.length} file(s) checked).`);
  process.exit(0);
}

console.error('test-hygiene: failed');
for (const finding of findings) {
  console.error(
    `- ${finding.file}:${finding.line} [${finding.kind}] ${finding.message}\n  ${finding.snippet}`
  );
}
console.error(`\nFound ${findings.length} issue(s) across ${normalizedFiles.length} file(s).`);
process.exit(1);
