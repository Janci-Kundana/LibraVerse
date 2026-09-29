// Runs before each test file, before any app module is imported.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/libraverse-test';
process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-000000000000000000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-11111111111111111111';
process.env.CARD_QR_SECRET = 'test-card-secret-22222222222222222222222';
process.env.CRON_ENABLED = 'false';
delete process.env.SMTP_HOST;
