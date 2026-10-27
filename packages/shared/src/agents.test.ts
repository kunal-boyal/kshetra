import { describe, expect, it } from 'vitest';
import { describeAgent } from './agents';

describe('describeAgent (decision D101)', () => {
  it('names common browsers and systems, and nothing it doesn’t know', () => {
    expect(
      describeAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toEqual({ browser: 'Chrome', system: 'macOS' });
    expect(
      describeAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toEqual({ browser: 'Edge', system: 'Windows' });
    expect(
      describeAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ browser: 'Safari', system: 'iOS' });
    expect(describeAgent('okhttp/4.12.0')).toEqual({ browser: null, system: null });
    expect(describeAgent(null)).toEqual({ browser: null, system: null });
  });
});
