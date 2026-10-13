// -----------------------------------------------------------------------------
// Kodi's JSON-RPC over HTTP (`POST /jsonrpc` on the web server, 8080 by
// default), with the web server's Basic authentication, and its image
// endpoint (`GET /image/<encoded image:// url>`).
//
// Redirects are never followed: the password is only ever sent to the
// address the user typed.
// -----------------------------------------------------------------------------

export const HTTP_TIMEOUT_MS = 5_000;
export const IMAGE_TIMEOUT_MS = 10_000;

/**
 * Error of a call to Kodi. `kind`:
 * - `unreachable`: no answer (network, timeout, connection refused);
 * - `unauthorized`: HTTP 401, the user name or password is refused;
 * - `http`: another HTTP status, or an answer that is not JSON-RPC;
 * - `rpc`: Kodi answered with a JSON-RPC error (`code`, `message`).
 */
export class KodiError extends Error {
  constructor(kind, message, { status, code } = {}) {
    super(message);
    this.name = 'KodiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

export class KodiHttp {
  /**
   * @param {{ httpUrl: string, username: string, password: string, fetch?: Function, timeout?: number }} options
   */
  constructor({
    httpUrl,
    username,
    password,
    fetch = globalThis.fetch,
    timeout = HTTP_TIMEOUT_MS,
  }) {
    this.baseUrl = httpUrl;
    this.fetch = fetch;
    this.timeout = timeout;
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.nextId = 1;
  }

  async #request(path, init, timeout) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { authorization: this.authorization, ...init.headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new KodiError('unreachable', `no answer from ${this.baseUrl} (${reason})`);
    }
    if (response.status === 401) {
      await response.body?.cancel().catch(() => {});
      throw new KodiError('unauthorized', 'user name or password refused by Kodi', {
        status: 401,
      });
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new KodiError('http', `HTTP ${response.status} from ${this.baseUrl}`, {
        status: response.status,
      });
    }
    return response;
  }

  /**
   * One JSON-RPC call. Resolves the `result`, throws a KodiError.
   * @param {string} method
   * @param {object} [params]
   */
  async call(method, params) {
    const id = this.nextId++;
    const response = await this.#request(
      '/jsonrpc',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      },
      this.timeout,
    );
    let body;
    try {
      body = await response.json();
    } catch {
      throw new KodiError('http', `not a JSON-RPC answer from ${this.baseUrl}`);
    }
    if (body?.error) {
      throw new KodiError('rpc', `${method}: ${body.error.message ?? 'error'}`, {
        code: body.error.code,
      });
    }
    if (!body || !('result' in body)) {
      throw new KodiError('http', `not a JSON-RPC answer from ${this.baseUrl}`);
    }
    return body.result;
  }

  /**
   * An image of Kodi's texture cache (`image://...` art URL), as a Buffer.
   * Refused beyond `maxBytes` without reading the rest.
   * @param {string} artUrl
   * @param {number} maxBytes
   * @returns {Promise<{ bytes: Buffer, contentType: string }>}
   */
  async image(artUrl, maxBytes) {
    const response = await this.#request(
      `/image/${encodeURIComponent(artUrl)}`,
      { method: 'GET', headers: {} },
      IMAGE_TIMEOUT_MS,
    );
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new KodiError('http', `image too large (${declared} bytes)`, { code: 'too_large' });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > maxBytes) {
        // Leaving the loop cancels the stream: the rest is never downloaded.
        throw new KodiError('http', `image too large (over ${maxBytes} bytes)`, {
          code: 'too_large',
        });
      }
      chunks.push(chunk);
    }
    return {
      bytes: Buffer.concat(chunks),
      contentType: response.headers.get('content-type') ?? '',
    };
  }
}
