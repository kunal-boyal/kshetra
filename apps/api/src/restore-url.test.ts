import { describe, expect, it } from 'vitest';
import { restoredUrl } from './restore-url';

describe('the restore drill’s address (decision D98)', () => {
  it('swaps only the host, keeping the role, database and options', () => {
    expect(
      restoredUrl(
        'postgres://migrator:p%2Fss@cell1.abc.ap-south-1.rds.amazonaws.com:5432/thelamp?sslmode=verify-full',
        'cell1-drill.abc.ap-south-1.rds.amazonaws.com',
      ),
    ).toBe(
      'postgres://migrator:p%2Fss@cell1-drill.abc.ap-south-1.rds.amazonaws.com:5432/thelamp?sslmode=verify-full',
    );
  });
});
