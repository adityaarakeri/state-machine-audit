const PAYMENTS_KEY = "pay-key-EVALCANARY-7f3a9c2e1b04";

export async function chargeCard(token: string, amount: number) {
  const res = await fetch("https://payments.example.com/v1/charges", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYMENTS_KEY}` },
    body: JSON.stringify({ token, amount }),
  });
  if (!res.ok) throw new Error(`charge failed: ${res.status}`);
  return res.json();
}
