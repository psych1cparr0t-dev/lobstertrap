import chalk from 'chalk';
import ora from 'ora';
import { startServer } from '../../api/server';

export async function openDashboard(_args: string[]): Promise<void> {
  console.log(chalk.cyan('\n🦞 LobsterTrap Dashboard\n'));

  const spinner = ora('Starting dashboard server...').start();

  let port: number;
  try {
    port = await startServer();
    spinner.succeed(`Dashboard running at ${chalk.bold(`http://localhost:${port}`)}`);
  } catch (err: any) {
    spinner.fail('Failed to start dashboard server');
    throw err;
  }

  // Open in browser
  const url = `http://localhost:${port}`;
  try {
    const open = await import('open');
    await open.default(url);
    console.log(chalk.gray(`  Opened in browser.\n`));
  } catch {
    console.log(chalk.gray(`  Open manually: ${url}\n`));
  }

  console.log(chalk.gray('  Press Ctrl+C to stop the dashboard.\n'));

  // Keep alive
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n  Dashboard stopped.\n'));
    process.exit(0);
  });

  await new Promise(() => {}); // keep process alive
}
