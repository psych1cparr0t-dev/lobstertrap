import chalk from 'chalk';
import { execSync } from 'child_process';

interface Dependency {
  name: string;
  check: () => boolean;
  installMsg: string;
  required: boolean;
}

const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';

function cmd(command: string): boolean {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const DEPENDENCIES: Dependency[] = [
  {
    name: 'Docker',
    required: true,
    check: () => cmd('docker info'),
    installMsg: isMac
      ? `Install Docker Desktop for Mac:\n     https://docs.docker.com/desktop/install/mac-install/\n     Or via Homebrew: ${chalk.cyan('brew install --cask docker')}`
      : isLinux
      ? `Install Docker Engine:\n     ${chalk.cyan('curl -fsSL https://get.docker.com | sh')}\n     Then start it: ${chalk.cyan('sudo systemctl start docker')}`
      : `Install Docker Desktop for Windows:\n     https://docs.docker.com/desktop/install/windows-install/`,
  },
  {
    name: 'Docker daemon',
    required: true,
    check: () => cmd('docker ps'),
    installMsg: isMac
      ? `Docker is installed but not running.\n     Open Docker Desktop from your Applications folder.`
      : isLinux
      ? `Start Docker: ${chalk.cyan('sudo systemctl start docker')}`
      : `Open Docker Desktop from the Start menu.`,
  },
  {
    name: 'Node.js (v18+)',
    required: true,
    check: () => {
      try {
        const version = execSync('node --version', { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString()
          .trim()
          .replace('v', '');
        const major = parseInt(version.split('.')[0], 10);
        return major >= 18;
      } catch {
        return false;
      }
    },
    installMsg: isMac
      ? `Install Node.js v18+:\n     ${chalk.cyan('brew install node')}\n     Or download from: https://nodejs.org`
      : `Download Node.js v18+ from: https://nodejs.org`,
  },
  {
    name: 'Python 3.9+',
    required: false,
    check: () => {
      for (const bin of ['python3', 'python']) {
        try {
          const out = execSync(`${bin} --version`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
          const match = out.match(/(\d+)\.(\d+)/);
          if (match && parseInt(match[1], 10) >= 3 && parseInt(match[2], 10) >= 9) return true;
        } catch {}
      }
      return false;
    },
    installMsg: isMac
      ? `Install Python 3.9+:\n     ${chalk.cyan('brew install python')}`
      : isLinux
      ? `Install Python 3.9+:\n     ${chalk.cyan('sudo apt install python3')}`
      : `Download from: https://python.org`,
  },
  {
    name: 'kubectl',
    required: false,
    check: () => cmd('kubectl version --client'),
    installMsg: isMac
      ? `Install kubectl (optional, for Kubernetes):\n     ${chalk.cyan('brew install kubectl')}`
      : `Install kubectl: https://kubernetes.io/docs/tasks/tools/`,
  },
];

export interface CheckResult {
  passed: boolean;
  missing: Dependency[];
  warnings: Dependency[];
}

export async function checkDependencies(opts: { required?: boolean; verbose?: boolean } = {}): Promise<CheckResult> {
  const { verbose = false } = opts;
  const missing: Dependency[] = [];
  const warnings: Dependency[] = [];

  for (const dep of DEPENDENCIES) {
    const ok = dep.check();
    if (!ok) {
      if (dep.required) missing.push(dep);
      else warnings.push(dep);
    } else if (verbose) {
      console.log(`  ${chalk.green('✓')} ${dep.name}`);
    }
  }

  return { passed: missing.length === 0, missing, warnings };
}

export function printMissingDeps(missing: Dependency[], warnings: Dependency[]): void {
  if (missing.length > 0) {
    console.log(chalk.red('\n✗ Missing required dependencies:\n'));
    for (const dep of missing) {
      console.log(`  ${chalk.bold(dep.name)}`);
      console.log(`     ${dep.installMsg}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow('⚠ Optional dependencies not found:\n'));
    for (const dep of warnings) {
      console.log(`  ${chalk.bold(dep.name)}`);
      console.log(`     ${dep.installMsg}\n`);
    }
  }
}

export async function requireDependencies(deps: string[] = ['Docker', 'Docker daemon']): Promise<void> {
  const { missing, warnings } = await checkDependencies();
  const blockers = missing.filter((d) => deps.includes(d.name));

  if (blockers.length > 0) {
    printMissingDeps(blockers, []);
    console.log(chalk.red('Fix the above and try again.\n'));
    process.exit(1);
  }
}
