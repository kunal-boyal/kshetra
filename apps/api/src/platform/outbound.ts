import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';

/**
 * Calls to addresses a tenant names (decision D101): webhook receivers and single sign-on issuers.
 * In production they go to the public internet only. Every address a name resolves to is checked
 * against the special-purpose ranges, and the connection is made to the address that was checked,
 * so a name can't resolve to something public for the check and something private for the call.
 */

/** IANA's special-purpose ranges, and everything a cell's own network or AWS's metadata sits in. */
const RESERVED = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  RESERVED.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  // NAT64 and 6to4, which reach IPv4 inside. IPv4 written as IPv6 (`::ffff:…`, in any notation)
  // is checked against the IPv4 ranges by BlockList itself.
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2002::', 16],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  RESERVED.addSubnet(address, prefix, 'ipv6');
}

/** Whether an address is outside the public internet. */
export function isReserved(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  return RESERVED.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export class ReservedAddress extends Error {
  constructor() {
    super('Use a public address; private networks can’t be reached');
  }
}

/**
 * A `lookup` for sockets that resolves as usual and refuses a name if any of its addresses is
 * reserved, so the socket connects only to an address that passed.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, found) => {
    if (error) return callback(error, '', 0);
    const addresses = found as unknown as LookupAddress[];
    if (addresses.length === 0 || addresses.some((each) => isReserved(each.address))) {
      return callback(new ReservedAddress() as NodeJS.ErrnoException, '', 0);
    }
    if ((options as { all?: boolean }).all) {
      return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    }
    return callback(null, addresses[0]!.address, addresses[0]!.family);
  });
};

/** What is wrong with an address a tenant gave, or null: https, no credentials, port 443, public. */
export async function publicUrlIssue(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Write a full address, such as https://erp.example.com/hooks';
  }
  if (parsed.protocol !== 'https:') return 'Use an https:// address';
  if (parsed.username || parsed.password) return 'Leave the user name and password out of it';
  // The cell's tasks may only leave on 443 (decision D101).
  if (parsed.port && parsed.port !== '443') return 'Use the standard HTTPS port';
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return isReserved(host) ? new ReservedAddress().message : null;
  return new Promise((resolve) =>
    dnsLookup(host, { all: true }, (error, found) => {
      if (error || found.length === 0) return resolve('This address can’t be found');
      resolve(
        found.some((each) => isReserved(each.address)) ? new ReservedAddress().message : null,
      );
    }),
  );
}

/**
 * A `fetch` to the public internet only, over HTTPS, never following a redirect: the request is
 * made with `publicLookup`, so the address connected to is the one checked. It answers with a
 * standard Response, so libraries that take a fetch, such as openid-client, can use it.
 */
export async function publicFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input);
  const issue = await publicUrlIssue(url.href);
  if (issue) throw new TypeError(issue);
  const headers = new Headers(init.headers);
  const body =
    init.body === undefined || init.body === null
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : Buffer.from(await new Response(init.body).arrayBuffer());
  if (init.body instanceof URLSearchParams && !headers.has('content-type')) {
    headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
  }
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: init.method ?? 'GET',
        headers: Object.fromEntries(headers),
        lookup: publicLookup,
        ...(init.signal ? { signal: init.signal } : {}),
      },
      (response) => {
        const answer = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (value === undefined) continue;
          for (const each of Array.isArray(value) ? value : [value]) answer.append(name, each);
        }
        const status = response.statusCode ?? 502;
        const empty = status === 204 || status === 304 || init.method === 'HEAD';
        if (empty) response.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(response) as ReadableStream), {
            status,
            statusText: response.statusMessage ?? '',
            headers: answer,
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}
