/** Formats integer paise as rupees, e.g. 49900 → "₹499". */
export function rupees(paise: number): string {
  const value = paise / 100;
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Parses a rupee amount typed by a user into integer paise. */
export function toPaise(rupeeText: string): number {
  return Math.round(Number(rupeeText) * 100);
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
