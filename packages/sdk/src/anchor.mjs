/**
 * Stellar anchor client: the Turkish lira rail.
 *
 * Speaks the standard SEP flows against any anchor's home domain, so moving
 * from the sandbox to a production TRY anchor is a config change rather than a
 * rewrite. Defaults to `tr-mock-anchor.fly.dev`, which implements
 * SEP-1/6/10/12/38 on testnet.
 *
 * ## The thing to understand about this rail
 *
 * The anchor takes Turkish lira and settles **USDC**, not a TRY token. So lira
 * is the fiat leg and USDC is the on-chain unit of account -- which is why the
 * campaign contract and the vault are denominated in USDC. A design that put a
 * "TRY token" on chain would have no anchor willing to redeem it.
 *
 * Deposit limits are the anchor's, not ours: 50-3000 TRY in, minimum 1 USDC out.
 *
 * ## What is real and what is simulated
 *
 * The USDC settlement is real testnet activity. The bank transfer, the KYC and
 * the lira payout are simulated by the sandbox so a round trip takes seconds
 * instead of days. `simulateBankTransfer()` is the sandbox-only call that
 * stands in for the customer actually sending the wire.
 */

const DEFAULT_HOME_DOMAIN = "tr-mock-anchor.fly.dev";

export class AnchorClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.homeDomain] Anchor home domain, without scheme.
   * @param {typeof fetch} [opts.fetch]
   */
  constructor({
    homeDomain = DEFAULT_HOME_DOMAIN,
    // Wrapped rather than stored bare: browsers throw "Illegal invocation" when
    // `fetch` is called as a method of anything but `window`. Node does not
    // care, which is why the scripts never hit it.
    fetch: f = (...args) => globalThis.fetch(...args),
  } = {}) {
    this.homeDomain = homeDomain;
    this.base = `https://${homeDomain}`;
    this.fetch = f;
    this.toml = null;
    this.jwt = null;
  }

  async #json(url, init) {
    const res = await this.fetch(url, init);
    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { raw: body };
    }
    if (!res.ok) {
      const detail = parsed?.error ?? parsed?.raw ?? res.statusText;
      throw new Error(`anchor ${res.status}: ${detail}`);
    }
    return parsed;
  }

  /** SEP-1: discover the anchor's endpoints and signing key. */
  async discover() {
    if (this.toml) return this.toml;
    const res = await this.fetch(`${this.base}/.well-known/stellar.toml`);
    if (!res.ok) throw new Error(`stellar.toml: ${res.status}`);
    const text = await res.text();

    // A deliberately small TOML reader: the handful of flat string keys the
    // SEP flows need. Pulling in a TOML parser for five lookups is not worth
    // the dependency in a browser bundle.
    const get = (key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];

    this.toml = {
      webAuthEndpoint: get("WEB_AUTH_ENDPOINT"),
      transferServer: get("TRANSFER_SERVER"),
      kycServer: get("KYC_SERVER"),
      quoteServer: get("ANCHOR_QUOTE_SERVER"),
      signingKey: get("SIGNING_KEY"),
      networkPassphrase: get("NETWORK_PASSPHRASE"),
    };
    if (!this.toml.webAuthEndpoint || !this.toml.transferServer) {
      throw new Error(`${this.homeDomain} does not publish the SEP-10/SEP-6 endpoints`);
    }
    return this.toml;
  }

  /**
   * SEP-10: prove control of the account and get a session JWT.
   *
   * There is no API key anywhere in this flow -- the Stellar key *is* the
   * identity, which is what makes the rail non-custodial.
   *
   * @param {string} account The G-address authenticating.
   * @param {(xdr: string, networkPassphrase: string) => Promise<string>|string} sign
   *        Signs the challenge transaction and returns the signed XDR.
   */
  async authenticate(account, sign) {
    const { webAuthEndpoint } = await this.discover();
    const challenge = await this.#json(`${webAuthEndpoint}?account=${account}`);
    const signed = await sign(challenge.transaction, challenge.network_passphrase);
    const { token } = await this.#json(webAuthEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: signed }),
    });
    this.jwt = token;
    return token;
  }

  get authenticated() {
    return Boolean(this.jwt);
  }

  #auth() {
    if (!this.jwt) throw new Error("not authenticated -- call authenticate() first");
    return { Authorization: `Bearer ${this.jwt}` };
  }

  /** SEP-38: an indicative or firm USDC/TRY rate. */
  async quote({ sellAsset = "iso4217:TRY", buyAsset, sellAmount }) {
    const { quoteServer } = await this.discover();
    const params = new URLSearchParams({
      sell_asset: sellAsset,
      buy_asset: buyAsset,
      sell_amount: String(sellAmount),
    });
    return this.#json(`${quoteServer}/price?${params}`, { headers: this.#auth() });
  }

  /** SEP-6 `/info`: supported assets, limits and fees. */
  async info() {
    const { transferServer } = await this.discover();
    return this.#json(`${transferServer}/info`);
  }

  /**
   * SEP-6 deposit: lira in, USDC out.
   *
   * `amount` is the **fiat** figure, in Turkish lira -- not the USDC the
   * customer will receive. The sandbox enforces 50-3000 TRY per deposit and
   * rejects anything smaller with `amount below minimum (50.00 TRY)`.
   * Use `quote()` to show the customer what they will actually get.
   *
   * Returns the bank instructions and a transaction id to poll.
   */
  async startDeposit({ account, amount, assetCode = "USDC" }) {
    const { transferServer } = await this.discover();
    const params = new URLSearchParams({
      asset_code: assetCode,
      account,
      amount: String(amount),
      funding_method: "bank_account",
    });
    return this.#json(`${transferServer}/deposit?${params}`, { headers: this.#auth() });
  }

  /**
   * Sandbox only: stand in for the customer actually wiring the lira.
   * A production anchor learns about the transfer from its bank instead.
   */
  async simulateBankTransfer(transactionId, amount) {
    return this.#json(`${this.base}/sep6/tx/${transactionId}/simulate-bank-transfer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: String(amount) }),
    });
  }

  /**
   * SEP-12: register the customer's details with the anchor.
   *
   * For a withdrawal this is where the payout IBAN goes -- SEP-6 `/withdraw`
   * itself has no bank field for `bank_account`. The sandbox auto-approves and
   * falls back to its own IBAN when none is given; a production anchor uses
   * the same endpoint for real KYC.
   *
   * @param {Record<string, string>} fields e.g. `{ bank_account_number, bank_name }`
   */
  async putCustomer(fields) {
    const { kycServer } = await this.discover();
    if (!kycServer) throw new Error(`${this.homeDomain} does not publish a SEP-12 KYC server`);
    return this.#json(`${kycServer}/customer`, {
      method: "PUT",
      headers: { ...this.#auth(), "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
  }

  /** SEP-6 withdraw: USDC in, lira to an IBAN. */
  async startWithdraw({ amount, assetCode = "USDC", type = "bank_account" }) {
    const { transferServer } = await this.discover();
    const params = new URLSearchParams({
      asset_code: assetCode,
      type,
      amount: String(amount),
    });
    return this.#json(`${transferServer}/withdraw?${params}`, { headers: this.#auth() });
  }

  async transaction(id) {
    const { transferServer } = await this.discover();
    return this.#json(`${transferServer}/transaction?id=${id}`, { headers: this.#auth() });
  }

  /**
   * Poll until the anchor reports a terminal state.
   * `completed` and `error` both end the wait; anything else keeps going.
   */
  async waitForCompletion(id, { intervalMs = 2000, timeoutMs = 120_000, onUpdate } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      const { transaction } = await this.transaction(id);
      if (transaction.status !== last) {
        last = transaction.status;
        onUpdate?.(transaction);
      }
      if (transaction.status === "completed") return transaction;
      if (transaction.status === "error") {
        throw new Error(`anchor transaction failed: ${transaction.message ?? "no detail"}`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`anchor transaction ${id} did not settle within ${timeoutMs}ms`);
  }
}

export const TRY_ANCHOR_HOME_DOMAIN = DEFAULT_HOME_DOMAIN;
