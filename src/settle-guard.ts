/**
 * Workers-safe seller settle guard (mirrors twzrd-x402-gate createTwzrdSettleGuard
 * + twzrdPayerScreen, without importing the npm package — its main entry uses
 * node:module createRequire which breaks workerd).
 *
 * Screens the payer via free GET /v1/intel/merchant_card/{wallet}. Advisory +
 * fail-open: timeout / error / unresolved payer → continue settlement.
 */

export type SettleCtx = {
  paymentPayload?: {
    payload?: Record<string, unknown> | null;
    payer?: unknown;
    [k: string]: unknown;
  } | null;
  requirements?: unknown;
};

export type SettleAbort = { abort: true; reason: string; message?: string };

type PayerScreen = {
  washFlagged?: boolean | null;
  decision?: string | null;
  reason?: string;
};

const DEFAULT_TIMEOUT_MS = 3000;

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function recordOf(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

/** Prefer signed scheme fields over client-supplied aliases. */
export async function extractPayer(ctx: SettleCtx): Promise<string | null> {
  const outer = recordOf(ctx.paymentPayload);
  const pl = recordOf(outer?.payload) ?? outer;
  if (!pl) return asString(outer?.payer);

  const auth = recordOf(pl.authorization);
  const fromAuth = asString(auth?.from);
  if (fromAuth) return fromAuth;

  const p2 = recordOf(pl.permit2Authorization);
  const fromP2 = asString(p2?.from);
  if (fromP2) return fromP2;

  const tx = asString(pl.transaction);
  if (tx && tx.length >= 32 && /^[A-Za-z0-9+/]+=*$/.test(tx)) {
    try {
      const svm = await import("@x402/svm");
      // Optional peer path — present in this starter's deps.
      const decoded = (svm as { decodeTransactionFromPayload?: (p: { transaction: string }) => unknown })
        .decodeTransactionFromPayload?.({ transaction: tx });
      const getPayer = (svm as { getTokenPayerFromTransaction?: (d: unknown) => string | null })
        .getTokenPayerFromTransaction;
      if (decoded && getPayer) {
        const p = asString(getPayer(decoded));
        if (p) return p;
      }
    } catch {
      /* fall through */
    }
  }

  return asString(pl.payer) ?? asString(outer?.payer);
}

async function fetchMerchantCard(
  wallet: string,
  intelBase: string,
  fetchImpl: typeof fetch,
): Promise<{ wash_flagged?: boolean; provider_reputation_tier?: string } | null> {
  try {
    const url = `${intelBase.replace(/\/+$/, "")}/v1/intel/merchant_card/${encodeURIComponent(wallet)}`;
    const resp = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    if (!resp.ok) return null;
    const body = (await resp.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object") return null;
    return body as { wash_flagged?: boolean; provider_reputation_tier?: string };
  } catch {
    return null;
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  if (!ms || ms <= 0) return work;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function createTwzrdSettleGuard(opts: {
  intelBase: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  onDecision?: (info: {
    payer: string | null;
    screen: PayerScreen | null;
    aborted: boolean;
    reason: string;
  }) => void;
}): (ctx: SettleCtx) => Promise<void | SettleAbort> {
  const intelBase = opts.intelBase;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function twzrdSettleGuard(ctx: SettleCtx): Promise<void | SettleAbort> {
    let payer: string | null = null;
    const emit = (screen: PayerScreen | null, aborted: boolean, reason: string) => {
      try {
        opts.onDecision?.({ payer, screen, aborted, reason });
      } catch {
        /* never break settle */
      }
    };

    try {
      return await withTimeout(
        (async () => {
          payer = await extractPayer(ctx);
          if (!payer) {
            emit(null, false, "twzrd_payer_unresolved");
            return; // fail-open
          }
          const card = await fetchMerchantCard(payer, intelBase, fetchImpl);
          if (!card) {
            emit(null, false, "twzrd_screen_unavailable");
            return; // fail-open
          }
          const washFlagged =
            typeof card.wash_flagged === "boolean" ? card.wash_flagged : null;
          const screen: PayerScreen = {
            washFlagged,
            reason:
              washFlagged === true ? "twzrd_payer_wash_flagged" : "twzrd_payer_merchant_card",
          };
          if (washFlagged === true) {
            emit(screen, true, "twzrd_payer_wash_flagged");
            return {
              abort: true,
              reason: "twzrd_payer_wash_flagged",
              message: "payer flagged as wash/sybil by TWZRD",
            };
          }
          emit(screen, false, screen.reason ?? "twzrd_payer_ok");
          return;
        })(),
        timeoutMs,
        "twzrd_screen_timeout",
      );
    } catch {
      emit(null, false, "twzrd_screen_error_failopen");
      return; // fail-open
    }
  };
}
