import mongoose from 'mongoose';

mongoose.set('strictQuery', true);

export async function connectDb(uri: string): Promise<void> {
  await mongoose.connect(uri);
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

type DbState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const READY_STATES: Record<number, DbState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function dbState(): DbState {
  return READY_STATES[mongoose.connection.readyState] ?? 'disconnected';
}
