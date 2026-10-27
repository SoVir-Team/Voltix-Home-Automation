import postgres from 'postgres';
import { migrate } from '../src/db/migrator';

/** Fresh schema for every test run. */
export default async function setup() {
  const url = process.env.DATABASE_URL!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await sql.end();
  await migrate(url, () => {});
}
