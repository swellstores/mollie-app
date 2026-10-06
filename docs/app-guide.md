# Mollie

The Mollie app adds Mollie as a payment method to your Swell checkout. Shoppers choose Mollie, pay on Mollie's secure payment page with the method they prefer, and return to a confirmed order. You can refund orders from Swell, in full or in part.

One Mollie account gives you every method Mollie offers for your shoppers: iDEAL in the Netherlands, Bancontact in Belgium, cards, PayPal, Apple Pay, bank transfer, and pay-later methods such as Klarna where your account has them. You choose which methods to offer in your Mollie dashboard.

## How it works

| When | What the app does |
|---|---|
| A shopper chooses Mollie at checkout | Creates a Mollie payment for the cart total and sends the shopper to Mollie's payment page. |
| The shopper pays and returns | Checks the payment with Mollie. The order is placed only if the payment is paid and the amount matches the order total. |
| The shopper pays but doesn't return | Creates the order from the cart within about 15 minutes, if the cart hasn't changed. Otherwise, flags the payment and emails you. |
| You refund an order in Swell | Refunds the shopper through Mollie. |
| Every 5 minutes | Checks your connection to Mollie and follows up payments from the last 14 days. |

## Before you begin

- A Mollie account. Test payments work right away; live payments need Mollie to verify your business first.
- A Mollie **website profile** with the payment methods you want to offer turned on.
- A store currency that Mollie supports, such as EUR. Mollie only shows methods that work for the payment's currency and amount.

## Set up

Install Mollie from the Swell App Store. Set up the test environment before the live one.

### 1. Create a Mollie API key

In your Mollie dashboard, go to **Developers > API keys**. Copy the **Test API key** (it starts with `test_`). Mollie shows each key only once, so keep it somewhere safe.

### 2. Add the key to Swell

Go to **Apps > Mollie > Settings**, paste the key into **API key**, and click **Save**. Within 5 minutes, the **Status** panel shows "Connected in test mode" and lists your payment methods.

### 3. Turn on Mollie at checkout

Go to **Settings > Payments > Mollie**, make sure it's enabled, and click **Save**. Checkout doesn't offer Mollie until you save it here.

### 4. Choose your payment methods

In your Mollie dashboard, go to **Settings > Website profiles > Payment methods** and turn on the methods you want. Changes there appear at checkout right away.

### 5. Place a test order

Place an order and choose Mollie. On Mollie's test page, pick the result you want to test, such as Paid or Failed. Check that the order is placed and shows Mollie as the payment method. Then refund it from the order page.

### 6. Go live

In the live environment, repeat steps 2 and 3 with your **Live API key** (it starts with `live_`). Each environment has its own settings.

## Using Mollie

### Checkout

Shoppers see a single **Mollie** option at checkout, with the message "You'll be sent to Mollie to complete your payment securely." On Mollie's page they see the amount, your payment description and every method your account offers for that payment.

If the shopper cancels or the payment fails, they return to checkout and can try again.

### Payment checks

Before an order is marked paid, the app checks the payment with Mollie. The payment must be paid, or authorized for methods that authorize first, and the amount must match the order total exactly. Otherwise the order's payment fails with the reason, for example "The amount paid on Mollie (EUR 10.00) doesn't match the order total (EUR 20.00)."

The amount always comes from the cart in Swell, never from the shopper's browser.

### Refunds

Refund from the order page in Swell with **Refund order**, in full or in part. Several partial refunds on one payment work too. If Mollie refuses a refund, for example for more than the remaining amount, the refund fails with Mollie's reason.

Refund from Swell rather than from your Mollie dashboard. A refund made in Mollie isn't copied to Swell.

### Pay-later methods

With each payment, the app sends Mollie the order lines (products, quantities, discounts, shipping, tax, gift cards and account credit) and the billing and shipping addresses. Klarna, in3, Riverty and Billie need these details; other methods ignore them.

If the lines don't add up exactly to the amount, or Mollie rejects them, the payment is created without them. Checkout still works, but pay-later methods aren't offered for that payment.

### Shoppers who pay and don't return

Sometimes a shopper pays on Mollie's page and closes it before returning to your store. Every 5 minutes the app follows up the payments started at checkout in the last 14 days:

| Situation | What the app does |
|---|---|
| Paid, and checkout placed a paid order | Marks the payment **Paid at checkout**. |
| Paid, no order yet, cart unchanged, paid more than 10 minutes ago | Creates the order from the cart and marks the payment **Order created by the app**. The shopper gets the normal order confirmation. |
| Paid, but the cart changed or is gone, the order couldn't be created, or the order isn't paid | Marks the payment **Needs attention**, with the reason, and emails your store admins. |
| Canceled, expired or failed on Mollie | Marks the payment **Not paid**. |
| Still open or pending | Checks again in 5 minutes. |

When you get an "Action needed" email, open **Orders > Mollie payments > Needs attention**. Each payment shows why it needs attention and links to it in Mollie. Either create the order by hand or refund the shopper in Mollie, then set the payment's outcome to **Resolved**.

## In the dashboard

| Location | What it shows |
|---|---|
| Orders > Mollie payments | Every Mollie payment started at checkout, with its amount, outcome, a short reason and its order. The **Needs attention** tab shows the payments you need to act on. Open a payment for the full note and an **Open in Mollie** link. |
| Order page | Mollie payments and refunds, with Mollie's payment id (`tr_…`) or refund id (`re_…`) as the transaction id. |
| Apps > Mollie > Settings | Your API key and payment description, and the **Status** panel. |
| Settings > Notifications | The "Action needed" email sent to store admins, which you can edit. |

## Settings

Settings are in **Apps > Mollie > Settings** and are saved separately for each environment.

| Setting | Description | Default |
|---|---|---|
| API key | Your Mollie API key: `test_…` in the test environment, `live_…` in live. | None |
| Payment description | Shown to shoppers on Mollie's payment page and on their bank statement, for example your store name. Up to 255 characters. | "Order at" and your store's web address |

The **Status** panel is read-only and updates every 5 minutes:

| Field | What it shows |
|---|---|
| Connection | Whether the API key works, and whether it's a test or live key. |
| Payment methods enabled in Mollie | The methods your Mollie account has turned on. |
| Payments needing attention | How many payments are waiting for you under **Needs attention**. |
| Last checked | When the app last checked. |

## Limitations

- Mollie can't notify the app the moment a payment completes, so the app checks every 5 minutes instead. A shopper who pays and doesn't return gets their order within about 15 minutes.
- If the cart changes after the shopper paid, for example in another tab, the app rejects the payment, but checkout still shows the shopper a confirmation. The order stays unpaid, and the payment appears under **Needs attention** with an email to you.
- Meal and eco vouchers (Edenred, Monizze, Pluxee and other voucher methods) aren't supported.
- Pay-later methods (Klarna, in3, Riverty, Billie) depend on your Mollie account and the shopper's country.
- Card payments are captured immediately.
- Subscriptions aren't supported. Mollie isn't offered for carts with subscription products.
- Refunds made in your Mollie dashboard aren't copied to Swell.
- If a shopper starts a second Mollie payment for the same cart, for example after going back, only the payment that matches the cart total is used. A paid payment that doesn't match shows under **Needs attention**.
- The dashboard shows a **New mollie payment** button on the Mollie payments page. Records added by hand are saved as **Not paid** and ignored.
- The API key is visible to store admins in the app settings.

## Troubleshooting

### Mollie doesn't appear at checkout

Check that Mollie is enabled and saved under **Settings > Payments > Mollie** in the environment you are testing. Then check the **Status** panel under **Apps > Mollie > Settings**: it should say "Connected" and list at least one payment method.

### The Status panel says the API key doesn't work

Paste the key again, without spaces, and check that it matches the environment: a `test_` key in test and a `live_` key in live. New keys are checked within 5 minutes.

### A payment method is missing on Mollie's page

Mollie only shows methods that are turned on for your website profile and that work for the payment's currency, amount and the shopper's country. Pay-later methods also need the order lines, which aren't sent when they don't add up exactly to the amount.

### A shopper paid but there's no order

Wait up to 15 minutes for the app to create it. If the payment shows under **Orders > Mollie payments > Needs attention**, follow the reason shown there.

## Uninstalling

Uninstalling the app removes Mollie from checkout. It applies to the environment you are in, so remove the app from the test and live environments separately.

Payments and refunds already made stay in your Mollie account, and orders stay in Swell. Payments that were still open aren't followed up after you uninstall, so check **Needs attention** before you remove the app.

## For developers

The app stores each Mollie payment started at checkout in its own collection, `apps/mollie/mollie-payments`.

| Field | Description |
|---|---|
| mollie_id | The Mollie payment id (`tr_…`). |
| mode | `test` or `live`, from the API key that created the payment. |
| cart_id, order_id | The cart the payment was created for, and its order once there is one. |
| amount, currency | The amount the shopper was asked to pay. |
| mollie_status | The last status seen on Mollie: open, pending, authorized, paid, canceled, expired or failed. |
| resolution | `pending`, `completed` (paid at checkout), `recovered` (order created by the app), `unmatched` (needs attention), `resolved` or `abandoned` (not paid). |
| reason, note | A short reason and the full explanation for payments that need attention. |
| date_paid, date_resolved | When the app first saw the payment as paid, and when it was resolved. |

The app's payment functions run on `payment.create_intent`, `payment.get_intent`, `payment.charge` and `payment.refund`. A job every 5 minutes updates the Status panel and follows up payments.

Mollie payments carry `cart_id` and `store_id` in their metadata. The order payment's transaction id is the Mollie payment id, and a refund's transaction id is the Mollie refund id.

## Support

Swell builds and maintains the Mollie app. For help with the app, email support@swell.is. For questions about your Mollie account, payment methods, fees or payouts, contact [Mollie](https://www.mollie.com/contact/merchants).
