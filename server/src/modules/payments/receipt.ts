import PDFDocument from 'pdfkit';

export interface ReceiptData {
  receiptNo: string;
  libraryName: string;
  memberName: string;
  membershipNo: string | null;
  description: string;
  amount: number; // paise
  discount: number;
  couponCode: string | null;
  method: string;
  paidAt: Date;
  razorpayPaymentId: string | null;
  collectedBy: string | null;
  refund: { amount: number; reason: string; refundedAt: Date } | null;
}

// PDFKit's built-in Helvetica has no ₹ glyph, so amounts print as "Rs.".
const money = (paise: number) =>
  `Rs. ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const METHOD_LABELS: Record<string, string> = {
  online: 'Online (Razorpay)',
  counterUpi: 'UPI at the counter (Razorpay)',
  cash: 'Cash at the counter',
};

/** A one-page A5 receipt (FR-23). */
export function receiptPdf(r: ReceiptData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A5', margin: 36 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  doc.font('Helvetica-Bold').fontSize(16).text(r.libraryName);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#666')
    .text('Payment receipt · issued via LibraVerse');
  doc.moveDown(1.2).fillColor('#000');

  const row = (label: string, value: string) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#555').text(label, 36, y, { width: 130 });
    doc
      .font('Helvetica')
      .fillColor('#000')
      .text(value, 170, y, { width: doc.page.width - 206 });
    doc.moveDown(0.4);
  };

  row('Receipt no.', r.receiptNo);
  row(
    'Date',
    r.paidAt.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }),
  );
  row(
    'Member',
    r.memberName +
      (r.membershipNo ? ` (No. ${r.membershipNo.replace(/(\d{4})(?=\d)/g, '$1 ')})` : ''),
  );
  row('For', r.description);
  row('Method', METHOD_LABELS[r.method] ?? r.method);
  if (r.razorpayPaymentId) row('Razorpay ref.', r.razorpayPaymentId);
  if (r.collectedBy) row('Collected by', r.collectedBy);
  if (r.discount > 0)
    row('Discount', `${money(r.discount)}${r.couponCode ? ` (coupon ${r.couponCode})` : ''}`);

  doc.moveDown(0.6);
  doc
    .moveTo(36, doc.y)
    .lineTo(doc.page.width - 36, doc.y)
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.6);
  doc
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(`Amount paid: ${money(r.amount)}`);

  if (r.refund) {
    doc.moveDown(0.6).font('Helvetica').fontSize(10).fillColor('#a11d30');
    doc.text(
      `Refunded ${money(r.refund.amount)} on ${r.refund.refundedAt.toLocaleDateString('en-IN')}: ${r.refund.reason}`,
    );
  }

  doc.end();
  return done;
}
