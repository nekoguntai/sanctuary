/**
 * Container Diagnostics Collector
 *
 * Collects process-level diagnostics that reveal container health issues
 * such as zombie process accumulation, missing init systems, and abnormal
 * process counts.
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { registerCollector } from './registry';

const execFile = promisify(execFileCb);

const EXEC_TIMEOUT_MS = 5_000;

interface ProcessEntry {
  pid: number;
  ppid: number;
  state: string;
  command: string;
}

function parsePsOutput(stdout: string): ProcessEntry[] {
  const lines = stdout.trim().split('\n');
  const entries: ProcessEntry[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts.length >= 4) {
      entries.push({
        pid: parseInt(parts[0], 10),
        ppid: parseInt(parts[1], 10),
        state: parts[2],
        command: parts.slice(3).join(' '),
      });
    }
  }
  return entries;
}

registerCollector('container', async () => {
  const { stdout } = await execFile('ps', ['-eo', 'pid,ppid,state,comm'], {
    timeout: EXEC_TIMEOUT_MS,
  });

  const processes = parsePsOutput(stdout);
  const zombies = processes.filter((p) => p.state === 'Z');
  const pid1 = processes.find((p) => p.pid === 1);

  return {
    totalProcesses: processes.length,
    zombies: zombies.map((z) => ({
      pid: z.pid,
      ppid: z.ppid,
      command: z.command,
    })),
    pid1: pid1
      ? { command: pid1.command, state: pid1.state }
      : null,
    hasDumbInit: pid1?.command === 'dumb-init',
  };
});
