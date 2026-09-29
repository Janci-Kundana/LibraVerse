import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import type { Types } from 'mongoose';
import { AppError } from '../../core/errors';
import { BookCopyModel } from '../copies/model';
import { BookModel } from './model';

// A4 sheet of 3 × 8 stickers, each with the copy's QR, title, shelf and code.
const COLS = 3;
const ROWS = 8;
const PAGE = { width: 595.28, height: 841.89, margin: 24 };

export async function stickerSheet(
  filter: { bookId?: Types.ObjectId; copyIds?: Types.ObjectId[] },
  libraryName: string,
): Promise<Buffer> {
  if (!filter.bookId && !filter.copyIds?.length) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Pass bookId or copyIds');
  }
  const copies = await BookCopyModel.find({
    ...(filter.bookId ? { bookId: filter.bookId } : {}),
    ...(filter.copyIds ? { _id: { $in: filter.copyIds } } : {}),
    status: { $ne: 'lost' },
  })
    .sort({ bookId: 1, createdAt: 1 })
    .lean();
  if (copies.length === 0) throw new AppError(404, 'NOT_FOUND', 'No copies to print');
  const books = await BookModel.find({ _id: { $in: copies.map((c) => c.bookId) } })
    .select('title')
    .lean();
  const titles = new Map(books.map((b) => [String(b._id), b.title]));

  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const cellW = (PAGE.width - PAGE.margin * 2) / COLS;
  const cellH = (PAGE.height - PAGE.margin * 2) / ROWS;
  const qrSize = cellH - 16;

  for (const [i, copy] of copies.entries()) {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.addPage();
    const x = PAGE.margin + (slot % COLS) * cellW;
    const y = PAGE.margin + Math.floor(slot / COLS) * cellH;

    doc
      .rect(x + 2, y + 2, cellW - 4, cellH - 4)
      .lineWidth(0.3)
      .dash(2, { space: 2 })
      .stroke()
      .undash();
    const png = await QRCode.toBuffer(copy.qrCode, {
      margin: 0,
      width: 200,
      errorCorrectionLevel: 'M',
    });
    doc.image(png, x + 8, y + 8, { width: qrSize, height: qrSize });

    const textX = x + qrSize + 14;
    const textW = cellW - qrSize - 20;
    doc
      .font('Helvetica')
      .fontSize(6)
      .fillColor('#666')
      .text(libraryName, textX, y + 10, { width: textW, lineBreak: false, ellipsis: true });
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#000')
      .text(titles.get(String(copy.bookId)) ?? '', textX, y + 20, {
        width: textW,
        height: 30,
        ellipsis: true,
      });
    doc
      .font('Helvetica')
      .fontSize(7)
      .text(copy.shelf ? `Shelf ${copy.shelf}` : '', textX, y + 54, { width: textW });
    doc
      .font('Courier')
      .fontSize(6)
      .text(copy.qrCode, textX, y + cellH - 22, { width: textW });
  }

  doc.end();
  return done;
}

export function copyQrPng(code: string): Promise<Buffer> {
  return QRCode.toBuffer(code, { margin: 1, width: 300, errorCorrectionLevel: 'M' });
}
