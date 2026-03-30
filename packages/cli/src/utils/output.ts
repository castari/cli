import chalk from 'chalk';

/**
 * Print a success message
 */
export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

/**
 * Print an info message
 */
export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

/**
 * Print a warning message
 */
export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

/**
 * Print an error message
 */
export function error(message: string): void {
  console.error(chalk.red('✗'), message);
}

/**
 * Print a hint/suggestion
 */
export function hint(message: string): void {
  console.log(chalk.gray('  →'), chalk.gray(message));
}

/**
 * Print a blank line
 */
export function blank(): void {
  console.log();
}

/**
 * Print a header
 */
export function header(title: string): void {
  console.log(chalk.bold(title));
}

/**
 * Print a key-value pair
 */
export function keyValue(key: string, value: string | number | undefined): void {
  console.log(`  ${chalk.gray(key + ':')} ${value ?? chalk.gray('N/A')}`);
}

/**
 * Format a number with commas
 */
export function formatNumber(n: number): string {
  return n.toLocaleString('es-US');
}

/**
 * Format a cost in USD
 */
export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

/**
 * Format a date string
 */
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
