// Runs before each test file, before any app module is imported.
process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/libraverse-test';
process.env.CLIENT_URL ??= 'http://localhost:5173';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-000000000000000000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-11111111111111111111';
process.env.CARD_QR_SECRET = 'test-card-secret-22222222222222222222222';
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_platform1';
process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'platform_secret';
process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'platform_webhook_secret';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
delete process.env.ANTHROPIC_API_KEY;
process.env.CRON_ENABLED = 'false';
delete process.env.SMTP_HOST;
