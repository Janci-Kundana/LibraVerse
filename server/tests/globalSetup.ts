import { MongoMemoryServer } from 'mongodb-memory-server';

// One in-memory MongoDB for the whole run; each test file gets its own database.
export default async function globalSetup() {
  const mongo = await MongoMemoryServer.create();
  (globalThis as { __MONGO__?: MongoMemoryServer }).__MONGO__ = mongo;
  process.env.TEST_MONGO_URI = mongo.getUri();
}
