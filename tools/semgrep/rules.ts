// Cases for tools/semgrep/rules.yml, checked by `semgrep --test`. Never compiled or run.
declare const sql: { raw(text: string): unknown };
declare const quote: (name: string) => string;
declare const logger: { log(message: string): void; warn(message: string): void };
declare const maskPhone: (phone: string) => string;
declare const tenantId: string;
declare const name: string;
declare const columns: string[];
declare const BATCH: number;
declare const configured: string;
declare const user: { phone: string; name: string };
declare const session: { accessToken: string };

// ruleid: thelamp-sql-raw-interpolated
sql.raw(`select 1 from cell.items where tenant_id = '${tenantId}'`);
// ok: thelamp-sql-raw-interpolated
sql.raw(`select 1 from cell.${quote(name)}`);
// ok: thelamp-sql-raw-interpolated
sql.raw(`insert into t (${columns.map(quote).join(', ')})`);
// ok: thelamp-sql-raw-interpolated
sql.raw('close archive_rows');
// ok: thelamp-sql-raw-interpolated
sql.raw(`fetch ${BATCH} from archive_rows`);

// ruleid: thelamp-regexp-from-configuration
new RegExp(configured);
// ok: thelamp-regexp-from-configuration
new RegExp('^[a-z]+$', 'i');

// ruleid: thelamp-token-in-web-storage
localStorage.setItem('refreshToken', session.accessToken);
// ruleid: thelamp-token-in-web-storage
sessionStorage.setItem('session', JSON.stringify(session));
// ok: thelamp-token-in-web-storage
localStorage.setItem('theme', 'dark');

// ruleid: thelamp-unmasked-personal-value-in-log
logger.log(`Code sent to ${user.phone}`);
// ruleid: thelamp-unmasked-personal-value-in-log
logger.warn(session.accessToken);
// ok: thelamp-unmasked-personal-value-in-log
logger.log(`Code sent to ${maskPhone(user.phone)}`);
// ok: thelamp-unmasked-personal-value-in-log
logger.log(`Welcome, ${user.name}`);
