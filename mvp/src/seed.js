export const courses = [];
export const classes = [];
export async function seed(db) {
  if (await db.prepare("SELECT value FROM settings WHERE key='seeded'").first()) return;
  await db.prepare("INSERT OR IGNORE INTO settings VALUES ('seeded','1')").run();
}
