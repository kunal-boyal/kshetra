/**
 * Photos the camera took for a screen that opened it, by that screen's request: the camera saves
 * and queues each photo, goes back, and the screen collects the IDs (spec 8.1 Camera). Forms
 * collect them from step 7.
 */
const taken = new Map<string, string[]>();

export function addResult(request: string, mediaId: string): void {
  taken.set(request, [...(taken.get(request) ?? []), mediaId]);
}

/** The photos taken for a request since it last asked, and forgets them. */
export function takeResults(request: string): string[] {
  const found = taken.get(request) ?? [];
  taken.delete(request);
  return found;
}
