import { CronTime } from 'cron';

/**
 * Validates a cron expression by letting the `cron` package (the same library that
 * will execute it) attempt to parse it — so "valid at the API boundary" and
 * "runnable by the scheduler" can never disagree. Supports 5- and 6-field syntax.
 */
export function isValidCronExpression(expression: string): boolean {
  try {
    new CronTime(expression);
    return true;
  } catch {
    return false;
  }
}
