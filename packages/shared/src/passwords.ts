/**
 * What staff passwords may not be built on, beyond their length (decision D101): the product's
 * names and the person's own name and email. The API also refuses passwords known from breaches.
 */

/** Letters and digits only, in lower case, so `Meera.Iyer` and `meeraiyer` read the same. */
const plain = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** The words a person's password may not contain: four letters or longer, each once. */
export function passwordWords(input: {
  product: readonly string[];
  email: string;
  name: string;
}): string[] {
  const local = input.email.split('@')[0] ?? '';
  const words = [...input.product, local, ...input.name.split(/\s+/)]
    .map(plain)
    .filter((word) => word.length >= 4);
  return [...new Set(words)];
}

/** The issue with a password that contains one of `words`, or null when it contains none. */
export function passwordWordsIssue(password: string, words: readonly string[]): string | null {
  const text = plain(password);
  return words.some((word) => text.includes(word))
    ? 'Leave out your name, your email and the product’s name'
    : null;
}
