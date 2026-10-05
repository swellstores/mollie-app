# Mollie for Swell

Accept payments through [Mollie](https://www.mollie.com) in your Swell checkout. Shoppers choose **Mollie** at checkout, pay on Mollie's secure payment page with any method you've turned on in Mollie (iDEAL, Bancontact, cards, PayPal, bank transfer, Klarna and more), and come back to a confirmed order. You can refund from the Swell order page. A safety net creates the order for shoppers who pay and close the page before returning, and tells you about any payment it can't match to a paid order.

- **One Mollie account, every method:** the app adds a single "Mollie" payment option. Which methods shoppers see on Mollie's page is controlled in your Mollie dashboard.
- **Works in test and live:** use your Mollie test key in Swell's test environment and your live key in live.

## Features

### Pay with Mollie at checkout
Shoppers pick **Mollie** as the payment method, are sent to Mollie's payment page, pay, and return to checkout, which places the order.

- **At checkout:** the Mollie option shows "You'll be sent to Mollie to complete your payment securely." If the shopper cancels or the payment fails, checkout asks them to try again.
- **On Mollie's page:** the amount, your payment description (see [Settings](#settings)), and the methods your Mollie account offers for that currency and amount.
- **The amount always comes from the cart on the server**, never from the browser.
- **Implemented by:**
  - `components/MolliePayment.tsx`: the checkout component. It creates the payment, sends the shopper to Mollie, and checks the payment when they return.
  - `functions/create-intent.ts` (`after:payment.create_intent`): creates the Mollie payment.
  - `functions/get-intent.ts` (`after:payment.get_intent`): looks up the payment's status when the shopper returns.

### Payments confirmed against Mollie
When checkout places the order, the app asks Mollie for the payment and only accepts it if it's **paid** (or held) and the amount paid **exactly matches the order total**. Otherwise the order's payment fails with the reason, for example "The amount paid on Mollie (EUR 10.00) doesn't match the order total (EUR 20.00)."

- **Held payments** (methods that authorize first) are captured when Swell captures the order's payment. A capture never exceeds what Mollie holds.
- **The Mollie payment id** (`tr_…`) is stored as the order payment's transaction id, and shows in Mollie's dashboard under the same id.
- **Implemented by:** `functions/charge.ts` (`after:payment.charge`).

### Refunds
Refund an order from Swell, in full or in part, and the app refunds the shopper through Mollie. Several partial refunds on one payment work too.

- **In the dashboard:** Orders → an order → **Refund order**. The refund's transaction id is Mollie's refund id (`re_…`).
- **If Mollie refuses** (for example more than the remaining amount), the refund fails with Mollie's reason.
- **Implemented by:** `functions/refund.ts` (`after:payment.refund`).

### Order lines and addresses for pay-later methods
With each payment the app sends Mollie the order's lines (products, quantities, discounts, shipping, tax, gift cards and account credit) and the billing and shipping address. Klarna, in3, Riverty and Billie need these; other methods ignore them.

- **Exact or nothing:** lines are calculated in cents and only sent when they add up exactly to the amount. If they don't, or Mollie rejects them, the payment is created without them, so checkout never breaks; those pay-later methods just aren't offered for that payment.
- **Implemented by:** `functions/lib/lines.ts`, used by `create-intent.ts`.

### Safety net: shoppers who pay and don't return
Mollie normally tells a shop about finished payments by calling it. Swell apps can't receive those calls yet (see [Limits](#limits-and-known-issues)), so the app checks instead. Every 5 minutes it follows up the payments started at checkout in the last 14 days:

| Situation | What the app does |
|---|---|
| Paid, and checkout placed a paid order | Marks it **Paid at checkout**. |
| Paid, no order yet, cart unchanged, paid more than 10 minutes ago | Creates the order from the cart and marks it **Order created by the app**. The shopper gets the normal order confirmation. |
| Paid, but the cart changed, the cart is gone, the order couldn't be created, or the order exists but isn't paid | Marks it **Needs attention**, with the reason, and emails the store admins. |
| Canceled, expired or failed on Mollie | Marks it **Not paid**. |
| Still open or pending | Checks again in 5 minutes. |

- **In the dashboard:** Orders → **Mollie payments**, with a **Needs attention** tab. The list shows each payment's outcome, a short reason, and the order. Open a payment for the full note and a link to it in Mollie.
- **Email:** "Action needed: a Mollie payment of EUR … has no paid order", sent to the store admins. Edit it under Settings → Notifications.
- **Status:** Apps → Mollie → Settings → **Status** shows how many payments need attention.
- **Implemented by:** `functions/check-payments.ts` (cron, every 5 minutes), `functions/lib/recovery.ts`, the `mollie-payments` collection, and `notifications/unmatched-payment`.

### Connection status
Apps → Mollie → Settings → **Status** shows whether the API key works (and whether it's a test or live key), which payment methods your Mollie account has turned on, how many payments need attention, and when the app last checked. It updates every 5 minutes.

- **Implemented by:** `functions/check-payments.ts`.

## Setup

1. **Get a Mollie account** at [mollie.com](https://www.mollie.com). Test payments work right away; live payments need Mollie's onboarding (business verification).
2. **Create an API key in Mollie:** Developers → **API keys** → create a **Standard API key** for your website profile, in **Test** mode for testing (`test_…`) or **Live** mode for real payments (`live_…`). Copy it straight away; Mollie only shows it once.
3. **Install the app** from the Swell App Store.
4. **Add the key:** Apps → **Mollie** → Settings → paste it into **API key** and save. Within 5 minutes, the **Status** panel should say "Connected in test mode" (or live) and list your payment methods.
5. **Turn Mollie on at checkout:** Settings → **Payments** → **Mollie** → **Save**, and make sure it's enabled. Until you save it there, checkout doesn't offer Mollie.
6. **Choose payment methods in Mollie:** Settings → Website profiles → **Payment methods**. Shoppers see whichever of these Mollie offers for their currency and amount.
7. **Place a test order** in your test environment and pay with Mollie's test page, where you choose the result (paid, failed, canceled…).

Swell's test and live environments have separate settings, so repeat steps 4 and 5 in each environment you use, with the matching key.

### Settings

| Panel | Setting | What it does |
|---|---|---|
| Mollie | API key | Your Mollie API key: `test_…` in Swell's test environment, `live_…` in live. |
| Mollie | Payment description | Shown to shoppers on Mollie's payment page and on their bank statement, for example your store name. Empty uses "Order at" and your store's web address. Up to 255 characters. |
| Status | Connection, Payment methods enabled in Mollie, Payments needing attention, Last checked | Read-only. Updated by the app every 5 minutes. |

## Day-to-day use

- **Orders arrive as usual.** Mollie orders show **Mollie** as the payment method, with the Mollie payment id as the transaction id.
- **Refund from Swell**, not from Mollie, so the order's payment status stays right. A refund made in Mollie's dashboard isn't copied to Swell.
- **Check Orders → Mollie payments → Needs attention** when you get an "Action needed" email. Each payment shows why it needs attention. Typically, either create the order by hand or refund the shopper in Mollie (use the **Open in Mollie** link), then set the payment's outcome to **Resolved**.
- **Methods and fees** are managed in your Mollie dashboard. Turning a method on or off there takes effect at checkout right away.

## Limits and known issues

- **No instant updates from Mollie.** Swell apps can't yet receive calls from outside services, so the app can't use Mollie's webhooks. A shopper who pays and closes the page gets their order through the safety net, within about 15 minutes (10 minutes' grace plus the 5-minute check).
- **Checkout confirms orders whose payment failed.** If the cart changed after the shopper paid (for example in another tab), the app correctly rejects the payment, but Swell's checkout still shows the shopper a confirmation. The order stays unpaid, and the safety net flags it under **Needs attention** with an email. This is a Swell checkout issue.
- **Meal and eco vouchers** (Edenred, Monizze, Pluxee and other voucher methods) aren't supported: Mollie needs a voucher category on each order line, which Swell products don't have.
- **Pay-later methods** (Klarna, in3, Riverty, Billie) depend on your Mollie account. Mollie only offers them in some countries.
- **Card payments are captured immediately** by Mollie. The app supports authorize-then-capture, but doesn't ask Mollie to hold card payments.
- **Subscriptions** aren't supported: Mollie isn't offered for carts with subscription products.
- **Payment records can look editable.** Swell apps can't hide the "New mollie payment" button. Records added by hand are saved as **Not paid** and ignored by the safety net.
- **One payment at a time:** if a shopper starts a second Mollie payment for the same cart (for example after going back), only the payment that matches the cart total is used. A paid payment that doesn't match shows under **Needs attention**.

## Development

Requirements: Node 20+, the Swell CLI (`npm install -g @swell/cli`), and access to the **swell-apps** store.

```bash
npm install
npm run typecheck
npm test
```

- **Tests:** unit tests live in `test/unit/` (vitest, Cloudflare Workers pool). They mock Swell and the Mollie API and block real network calls, so they need no credentials.
- **Deploy to the test environment:** `swell switch swell-apps`, then `swell app push`. **After changing anything in `functions/lib/`, push with `--force`** (see notes below). Then run `swell inspect functions --app=.` and `swell inspect extensions --app=.`.
- **Test checkout on another store:** don't create orders on swell-apps (other apps react to them). Create a version (`swell app version <x.y.z>`), install it on a test store (`swell app install -s <store> -e test -v <x.y.z>`), activate Mollie under Settings → Payments there, and wait about a minute before testing.

**Project layout:**

| Path | Contents |
|---|---|
| `swell.json` | App manifest with one payment extension, `mollie` |
| `components/` | `MolliePayment.tsx` (checkout component) and `lib/checkout.ts` (browser-safe helpers) |
| `functions/` | `create-intent`, `get-intent`, `charge`, `refund` (payment hooks), `check-payments` (cron), `reject-manual-payments` (`before:mollie-payment.created`) |
| `functions/lib/` | Mollie API client, amounts, order lines, payment records, safety net, settings, status |
| `models/` | `mollie-payments` collection |
| `content/` | The Mollie payments dashboard page |
| `settings/` | `mollie` (API key, description) and `status` (read-only, written by the cron) |
| `notifications/` | `unmatched-payment`, the "Action needed" email to store admins |
| `assets/` | `icon.png`; gallery images in `assets/images/`, listed in `swell.json` |

**Notes for the next developer:**

- **Push `--force` after lib changes:** a normal push uploads only the changed `functions/lib/` file and doesn't rebuild the functions that import it, so they keep running old code. When adding a new lib file, push `--force` twice.
- **New code takes about a minute to go live** after a push or install. Test after that, or you'll be testing the old code.
- **Charge calls:** Swell may call `payment.charge` once (capture only) instead of twice, so `charge.ts` checks the amount on every call.
- **Checkout redirect:** hosted checkout places the order itself when the shopper returns from Mollie, without calling the component's `onSubmit` again. Server-side checks in `charge.ts` are the guard.
- **Hooks can't cancel creates:** a `before:*.created` hook's error doesn't stop the record being saved, so `reject-manual-payments` changes the record instead.
- **Webhooks:** routes with `public: true` still need the store's secret key, so there's no Mollie webhook receiver. If Swell adds truly public routes, a webhook route (Mollie posts only `id=tr_…`; fetch the payment to verify) would replace most of the safety net's delay.
- **CLI validation:** `swell schema <type> <file>` currently fails on every file; validate against `swell schema <type> --format=json-schema-bundle` with ajv instead.
