import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, URL-safe, sortable-enough identifier (time prefix + random). */
export function newId(prefix?: string): string {
  const time = Date.now().toString(36);
  const bytes = randomBytes(10);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${time}${rand}` : `${time}${rand}`;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}
