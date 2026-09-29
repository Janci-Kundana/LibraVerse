import type { RequestHandler } from 'express';
import { Types } from 'mongoose';
import { notFound, parseId } from '../../core/ids';
import { libraryOf } from '../auth/middleware';
import { BookCopyModel } from '../copies/model';
import { LibraryModel } from '../libraries/model';
import * as books from './service';
import { copyQrPng, stickerSheet } from './stickers';
import { listBooksQuery, stickersQuery } from './validation';

export const list: RequestHandler = async (req, res) => {
  res.json(await books.listBooks(listBooksQuery.parse(req.query)));
};

export const get: RequestHandler = async (req, res) => {
  res.json(await books.getBook(String(req.params.id)));
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await books.createBook(libraryOf(req), req.body));
};

export const update: RequestHandler = async (req, res) => {
  res.json(await books.updateBook(libraryOf(req), String(req.params.id), req.body));
};

export const remove: RequestHandler = async (req, res) => {
  await books.deleteBook(String(req.params.id));
  res.status(204).end();
};

export const addCopies: RequestHandler = async (req, res) => {
  res.status(201).json(await books.addCopiesToBook(String(req.params.id), req.body));
};

export const updateCopy: RequestHandler = async (req, res) => {
  res.json(await books.updateCopy(String(req.params.id), req.body));
};

export const deleteCopy: RequestHandler = async (req, res) => {
  await books.deleteCopy(String(req.params.id));
  res.status(204).end();
};

export const lookupIsbn: RequestHandler = async (req, res) => {
  res.json(await books.lookupIsbn(String(req.params.isbn)));
};

export const importCsv: RequestHandler = async (req, res) => {
  res.json(await books.importCsv(req.body.csv));
};

export const stickers: RequestHandler = async (req, res) => {
  const q = stickersQuery.parse(req.query);
  const library = await LibraryModel.findById(libraryOf(req)).select('name').lean();
  const pdf = await stickerSheet(
    {
      bookId: q.bookId ? new Types.ObjectId(q.bookId) : undefined,
      copyIds: q.copyIds?.map((id) => new Types.ObjectId(id)),
    },
    library?.name ?? 'LibraVerse',
  );
  res
    .type('application/pdf')
    .set('Content-Disposition', 'inline; filename="qr-stickers.pdf"')
    .send(pdf);
};

export const copyQr: RequestHandler = async (req, res) => {
  const copy = await BookCopyModel.findById(parseId(req.params.id, 'Copy')).select('qrCode').lean();
  if (!copy) throw notFound('Copy');
  res.type('image/png').send(await copyQrPng(copy.qrCode));
};
