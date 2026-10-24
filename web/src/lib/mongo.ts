import { MongoClient, type Collection, type Db, type Document } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var __saasMongo: Promise<MongoClient> | undefined;
}

export const mongoConfigured = () => Boolean(process.env.MONGODB_URI);
export const mongoDbName = () => process.env.MONGODB_DB ?? "saas";

export async function mongoClient(): Promise<MongoClient> {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set.");
  global.__saasMongo ??= new MongoClient(process.env.MONGODB_URI).connect();
  return global.__saasMongo;
}

export async function db(): Promise<Db> {
  return (await mongoClient()).db(mongoDbName());
}

export async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  return (await db()).collection<T>(name);
}

export const garmentsCol = <T extends Document = Document>() => collection<T>("garments");
export const recipesCol = <T extends Document = Document>() => collection<T>("recipes");
export const bodiesCol = <T extends Document = Document>() => collection<T>("bodies");

/** Ordinary indexes. Vector and Atlas Search indexes live in atlas/indexes.json and are created in the Atlas UI. */
export async function ensureIndexes() {
  const [g, r, b] = await Promise.all([garmentsCol(), recipesCol(), bodiesCol()]);
  await Promise.all([
    g.createIndex({ createdAt: -1 }),
    g.createIndex({ family: 1, createdAt: -1 }),
    r.createIndex({ id: 1 }, { unique: true }),
    r.createIndex({ families: 1 }),
    b.createIndex({ createdAt: -1 }),
  ]);
}
