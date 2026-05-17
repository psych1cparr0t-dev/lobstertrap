import chalk from 'chalk';
import ora from 'ora';
import { checkDependencies, printMissingDeps } from '../../utils/dependencies';

export async function runDoctor(_args: string[]): Promise<void> {
  console.log(chalk.cyan('\n🦞 LobsterTrap — System Check\n'));

  const { passed, missing, warnings } = await checkDependencies();

  const checks = [
    { name: 'Docker installed', ok: !missing.find((d) => d.name === 'Docker') },
    { name: 'Docker daemon running', ok: !missing.find((d) => d.name === 'Docker daemon') },
    { name: 'Node.js v18+', ok: !missing.find((d) => d.name === 'Node.js (v18+)') },
    { name: 'Python 3.9+ (for local dev)', ok: !warnings.find((d) => d.name === 'Python 3.9+') },
    { name: 'kubectl (optional, for Kubernetes)', ok: !warnings.find((d) => d.name === 'kubectl') },
  ];

  for (const check of checks) {
    const icon = check.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${icon}  ${check.name}`);
  }

  console.log('');

  if (missing.length > 0 || warnings.length > 0) {
    printMissingDeps(missing, warnings);
  }

  if (passed) {
    console.log(chalk.green('All required dependencies are installed. You\'re good to go!\n'));
    console.log(`  Next: ${chalk.cyan('lobstertrap init-openclaw')}\n`);
  } else {
    console.log(chalk.red('Fix the required dependencies above and re-run:'));
    console.log(`  ${chalk.cyan('lobstertrap doctor')}\n`);
    process.exit(1);
  }
}
