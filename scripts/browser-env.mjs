// Задаёт отдельные адреса и реквизиты одноразового стенда, не читая рабочий .env.
export const browserEnv = {
  KONTUR_DISPOSABLE_BROWSER_TEST: '1',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '13316', MYSQL_DATABASE: 'kontur_browser_test',
  MYSQL_USER: 'kontur_test', MYSQL_PASSWORD: 'disposable-browser-only', MYSQL_SSL: 'false',
  REDIS_URL: 'redis://127.0.0.1:13379',
  AUTH_SECRET: 'disposable-browser-authentication-only', APP_ENCRYPTION_KEY: 'ab'.repeat(32),
  APP_URL: 'http://127.0.0.1:13300', PORT: '13300', HOSTNAME: '127.0.0.1',
  ADMIN_EMAIL: 'browser-owner@example.invalid', ADMIN_PASSWORD: 'disposable-browser-owner-123',
  ADMIN_NAME: 'Проверка браузера',
  S3_ENDPOINT: 'http://127.0.0.1:13900', S3_REGION: 'us-east-1', S3_BUCKET: 'kontur-browser-test',
  S3_ACCESS_KEY: 'kontur_test', S3_SECRET_KEY: 'disposable-browser-storage',
  WEB_PUSH_ENABLED: 'false', RECORDING_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1',
};
