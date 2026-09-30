// Loads Razorpay Checkout on demand. The browser never confirms a payment: the
// handler below only closes the modal; the server's verified webhook decides.

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: 'INR';
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
  timeout?: number;
  retry?: { enabled: boolean };
  theme?: { color: string };
  handler: () => void;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void; close: () => void };
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Razorpay Checkout'));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export async function openCheckout(opts: Omit<RazorpayOptions, 'currency' | 'retry' | 'theme'>) {
  await loadScript();
  // One attempt per order: a failed attempt ends the request, and paying again
  // creates a new one (the payment state machine treats "failed" as final).
  const rzp = new window.Razorpay!({
    ...opts,
    currency: 'INR',
    retry: { enabled: false },
    theme: { color: '#c0263a' },
  });
  rzp.open();
  return rzp;
}
