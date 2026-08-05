import { decodePaymentRequiredHeader } from "@x402/core/http";

export async function json(res: Response): Promise<any> {
  return res.json();
}

// x402 v2: challenge lives in base64 PAYMENT-REQUIRED header; body is `{}`.
export function challenge(res: Response): any {
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    throw new Error("response has no PAYMENT-REQUIRED header — not a v2 402 challenge");
  }
  return decodePaymentRequiredHeader(header);
}
