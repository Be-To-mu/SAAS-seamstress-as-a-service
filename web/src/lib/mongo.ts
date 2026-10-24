import { MongoClient, type Collection, type Document } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var __blazeresMongo: Promise<MongoClient> | undefined;
}

export const mongoConfigured = () => Boolean(process.env.MONGODB_URI);

export async function garments(): Promise<Collection<Document>> {
  global.__blazeresMongo ??= new MongoClient(process.env.MONGODB_URI!).connect();
  const client = await global.__blazeresMongo;
  return client.db(process.env.MONGODB_DB ?? "blazeres").collection("garments");
}
