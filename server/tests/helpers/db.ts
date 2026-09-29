import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../../src/core/db';
import { testOutbox } from '../../src/core/mailer';

/** Call once per test file: connects Mongoose to a fresh database and empties it after each test. */
export function useTestDb() {
  beforeAll(async () => {
    const base = process.env.TEST_MONGO_URI;
    if (!base) throw new Error('TEST_MONGO_URI missing; is jest globalSetup configured?');
    await connectDb(`${base}lv-${randomUUID()}`);
    // Build indexes up front so unique constraints hold from the first test.
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
  });

  afterEach(async () => {
    testOutbox.length = 0;
    const collections = await mongoose.connection.db?.collections();
    await Promise.all((collections ?? []).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.connection.db?.dropDatabase();
    await disconnectDb();
  });
}
