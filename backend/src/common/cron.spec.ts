import { isValidCronExpression } from './cron';

describe('isValidCronExpression', () => {
  it.each(['0 9 * * 1-5', '*/5 * * * *', '*/10 * * * * *'])('accepts %s', (expression) => {
    expect(isValidCronExpression(expression)).toBe(true);
  });

  it.each(['not-cron', '99 * * * *', '* * *'])('rejects %s', (expression) => {
    expect(isValidCronExpression(expression)).toBe(false);
  });
});
