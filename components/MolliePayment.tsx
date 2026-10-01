import { memo } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  amountMatches,
  isReturn,
  isSettled,
  returnOutcome,
  returnUrl,
  unwrapIntent,
  withoutReturnParam,
  type IntentPayment,
  type ReturnOutcome,
} from './lib/checkout';

export const config: SwellConfig = {
  extension: 'mollie',
  description: "Send the shopper to Mollie's payment page and handle their return",
};

interface Cart {
  id: string;
  currency?: string;
  capture_total?: number;
  grand_total?: number;
  billing?: { intent?: { mollie?: { id?: string } } };
}

interface Props {
  cart: Cart;
  createIntent: (data: object) => Promise<any>;
  getIntent: (data: object) => Promise<any>;
  updateCart: (data: object) => Promise<void>;
  registerHandlers: (handlers: { onSubmit: () => Promise<void>; handleRedirect: () => Promise<void> }) => void;
  onReady: () => void;
}

function MolliePayment(props: Props) {
  const [notice, setNotice] = useState<ReturnOutcome | null>(null);
  // Handlers are registered once; read the latest props through a ref.
  const propsRef = useRef(props);
  propsRef.current = props;

  async function currentPayment(): Promise<IntentPayment | null> {
    const { cart, getIntent } = propsRef.current;
    const id = cart?.billing?.intent?.mollie?.id;
    if (!id) return null;
    try {
      return unwrapIntent<IntentPayment>(await getIntent({ id }));
    } catch {
      return null; // Unknown or unreadable payment: start a new one.
    }
  }

  async function onSubmit() {
    const { cart, createIntent, updateCart } = propsRef.current;
    const total = cart.capture_total ?? cart.grand_total;

    const existing = await currentPayment();
    if (existing && isSettled(existing.status) && amountMatches(existing, total, cart.currency)) {
      return; // Already paid for this cart: let checkout place the order.
    }
    if (existing?.status === 'pending' && amountMatches(existing, total, cart.currency)) {
      throw new Error(returnOutcome('pending').message); // Don't charge the shopper twice.
    }

    const payment = unwrapIntent<IntentPayment & { checkout_url: string }>(
      await createIntent({ cart_id: cart.id, redirect_url: returnUrl(window.location) }),
    );

    await updateCart({
      billing: {
        method: 'mollie',
        mollie: { token: payment.id },
        intent: { mollie: { id: payment.id } },
      },
    });

    window.location.assign(payment.checkout_url);
    // The page is leaving for Mollie; never resolve so checkout doesn't try to place the order now.
    return new Promise<void>(() => {});
  }

  async function handleRedirect() {
    window.history.replaceState(null, '', withoutReturnParam(window.location));
    const payment = await currentPayment();
    const outcome = payment ? returnOutcome(payment.status) : returnOutcome('failed');
    setNotice(outcome);
    if (outcome.kind === 'retry') {
      throw new Error(outcome.message);
    }
  }

  useEffect(() => {
    props.registerHandlers({ onSubmit, handleRedirect });

    // Back from Mollie: check the payment ourselves, whether or not checkout calls handleRedirect.
    const init = isReturn(window.location) ? handleRedirect().catch(() => undefined) : Promise.resolve();
    init.finally(() => props.onReady());
  }, []);

  if (notice) {
    return (
      <p class={`mollie-notice mollie-notice--${notice.kind}`} role={notice.kind === 'retry' ? 'alert' : 'status'}>
        {notice.message}
      </p>
    );
  }

  return <p class="mollie-notice">You'll be sent to Mollie to complete your payment securely.</p>;
}

export default memo(MolliePayment);
