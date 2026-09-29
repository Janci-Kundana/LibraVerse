import request from 'supertest';
import { createApp } from '../src/app';
import { runWithTenant } from '../src/core/tenant';
import { BookCopyModel } from '../src/modules/copies/model';
import { MemberProfileModel } from '../src/modules/members/model';
import { PNG_DATA_URL, createLibrary, createUser, signedInAgent } from './helpers/fixtures';
import { useTestDb } from './helpers/db';

useTestDb();
const app = createApp();

async function setup() {
  const lib = await createLibrary('city');
  await createUser({ libraryId: lib.id, role: 'librarian', email: 'staff@city.test' });
  const member = await createUser({ libraryId: lib.id, role: 'member', email: 'reader@city.test' });
  await runWithTenant(lib.id, () =>
    MemberProfileModel.create({
      userId: member._id,
      idProofKey: 'k',
      termsAcceptedAt: new Date(),
      verificationStatus: 'approved',
    }),
  );
  return {
    lib,
    branchId: String(lib.branch._id),
    staff: await signedInAgent(app, 'staff@city.test'),
    reader: await signedInAgent(app, 'reader@city.test'),
  };
}

const dune = {
  title: 'Dune',
  authors: ['Frank Herbert'],
  isbn: '978-0-441-17271-9',
  category: 'Science fiction',
  language: 'English',
  publishedYear: 1965,
};

describe('catalog management (FR-14)', () => {
  it('adds a book with copies, each with its own unique QR code', async () => {
    const { staff, branchId } = await setup();
    const res = await staff
      .post('/api/books')
      .send({ ...dune, cover: PNG_DATA_URL, copies: { count: 3, branchId, shelf: 'A-3' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Dune',
      isbn: '9780441172719',
      copies: { total: 3, available: 3 },
    });
    expect(res.body.coverUrl).toMatch(/^\/api\/files\/public\/covers\//);
    const codes = res.body.copyList.map((c: { qrCode: string }) => c.qrCode);
    expect(new Set(codes).size).toBe(3);
    expect(codes.every((c: string) => /^LVC-[\w-]{12}$/.test(c))).toBe(true);
    expect(res.body.copyList[0]).toMatchObject({
      shelf: 'A-3',
      branchName: 'city main',
      status: 'available',
    });

    expect((await staff.post('/api/books').send(dune)).status).toBe(409);
  });

  it('edits books and copies, and refuses to delete a book with an issued copy', async () => {
    const { staff, branchId, lib } = await setup();
    const book = (await staff.post('/api/books').send({ ...dune, copies: { count: 2, branchId } }))
      .body;
    const [c1, c2] = book.copyList;

    const edited = await staff.put(`/api/books/${book.id}`).send({ ...dune, title: 'Dune (1965)' });
    expect(edited.body.title).toBe('Dune (1965)');

    const lost = await staff.put(`/api/copies/${c1.id}`).send({ status: 'lost', shelf: 'B-1' });
    expect(lost.body).toMatchObject({ status: 'lost', shelf: 'B-1' });
    expect((await staff.get(`/api/books/${book.id}`)).body.copies).toEqual({
      total: 1,
      available: 1,
    });

    await runWithTenant(lib.id, () =>
      BookCopyModel.updateOne({ _id: c2.id }, { status: 'issued' }),
    );
    expect((await staff.put(`/api/copies/${c2.id}`).send({ status: 'damaged' })).status).toBe(409);
    expect((await staff.delete(`/api/books/${book.id}`)).status).toBe(409);
  });

  it('auto-fills from Open Library by ISBN', async () => {
    const { staff } = await setup();
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          'ISBN:9780441172719': {
            title: 'Dune',
            authors: [{ name: 'Frank Herbert' }],
            publish_date: 'June 1990',
            subjects: [{ name: 'Science Fiction' }],
            cover: { large: 'http://covers.openlibrary.org/b/id/1-L.jpg' },
          },
        }),
      ),
    );
    const res = await staff.get('/api/books/isbn/978-0441172719');
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      isbn: '9780441172719',
      title: 'Dune',
      authors: ['Frank Herbert'],
      publishedYear: 1990,
      category: 'Science Fiction',
      coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      description: '',
    });
  });

  it('reports ISBN lookup misses and outages clearly', async () => {
    const { staff } = await setup();
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'));
    expect((await staff.get('/api/books/isbn/9780441172719')).status).toBe(404);
    spy.mockRejectedValueOnce(new Error('offline'));
    expect((await staff.get('/api/books/isbn/9780441172719')).status).toBe(502);
    spy.mockRestore();
    expect((await staff.get('/api/books/isbn/123')).status).toBe(400);
  });

  it('imports a CSV, adding copies to known ISBNs and reporting bad rows', async () => {
    const { staff } = await setup();
    await staff.post('/api/books').send(dune);
    const csv = [
      'title,authors,isbn,category,copies,shelf',
      'Dune,Frank Herbert,9780441172719,Science fiction,2,A-1',
      '"Sapiens, A Brief History",Yuval Noah Harari,,History,1,H-2',
      ',No title,,,1,',
      'Bad ISBN,Someone,12345,,1,',
    ].join('\n');
    const res = await staff.post('/api/books/import').send({ csv });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      created: 1,
      copiesCreated: 3,
      errors: [
        { row: 4, message: 'title is required' },
        { row: 5, message: 'isbn must be a 10- or 13-digit ISBN' },
      ],
    });
    const list = await staff.get('/api/books?q=sapiens');
    expect(list.body.items[0]).toMatchObject({
      title: 'Sapiens, A Brief History',
      copies: { total: 1 },
    });
  });

  it('prints a PDF sheet of QR stickers and a PNG per copy', async () => {
    const { staff, branchId } = await setup();
    const book = (await staff.post('/api/books').send({ ...dune, copies: { count: 25, branchId } }))
      .body;
    const pdf = await staff.get(`/api/books/stickers.pdf?bookId=${book.id}`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    const png = await staff.get(`/api/copies/${book.copyList[0].id}/qr.png`).buffer(true);
    expect(png.headers['content-type']).toBe('image/png');
  });

  it('members cannot manage the catalog', async () => {
    const { reader } = await setup();
    expect((await reader.post('/api/books').send(dune)).status).toBe(403);
    expect((await reader.get('/api/books')).status).toBe(403);
  });
});

describe('member discovery (FR-19)', () => {
  async function seeded() {
    const ctx = await setup();
    const { staff, branchId } = ctx;
    const a = (await staff.post('/api/books').send({ ...dune, copies: { count: 1, branchId } }))
      .body;
    const b = (
      await staff.post('/api/books').send({
        title: 'Wings of Fire',
        authors: ['A. P. J. Abdul Kalam'],
        category: 'Biography',
        language: 'English',
      })
    ).body;
    const c = (
      await staff.post('/api/books').send({
        title: 'Godaan',
        authors: ['Premchand'],
        category: 'Fiction',
        language: 'Hindi',
        copies: { count: 2, branchId },
      })
    ).body;
    return { ...ctx, a, b, c };
  }

  it('searches by title or author and filters by category, language and availability', async () => {
    const { reader } = await seeded();
    const byAuthor = await reader.get('/api/member/catalog/books?q=kalam');
    expect(byAuthor.body.items.map((x: { title: string }) => x.title)).toEqual(['Wings of Fire']);

    const hindi = await reader.get('/api/member/catalog/books?language=Hindi');
    expect(hindi.body.items.map((x: { title: string }) => x.title)).toEqual(['Godaan']);

    const available = await reader.get('/api/member/catalog/books?available=true&sort=title');
    expect(available.body.items.map((x: { title: string }) => x.title)).toEqual(['Dune', 'Godaan']);

    const facets = await reader.get('/api/member/catalog/facets');
    expect(facets.body).toEqual({
      categories: ['Biography', 'Fiction', 'Science fiction'],
      languages: ['English', 'Hindi'],
    });
  });

  it('lists new arrivals newest first', async () => {
    const { reader } = await seeded();
    const res = await reader.get('/api/member/catalog/books?sort=new');
    expect(res.body.items.map((x: { title: string }) => x.title)).toEqual([
      'Godaan',
      'Wings of Fire',
      'Dune',
    ]);
  });

  it('reviews update the rating; one review per member per book', async () => {
    const { reader, a } = await seeded();
    await reader.put(`/api/member/catalog/books/${a.id}/review`).send({ rating: 4, text: 'Epic' });
    const again = await reader.put(`/api/member/catalog/books/${a.id}/review`).send({ rating: 2 });
    expect(again.body).toMatchObject({ ratingAvg: 2, ratingCount: 1 });
    expect(again.body.reviews).toEqual([
      expect.objectContaining({ rating: 2, mine: true, memberName: 'member' }),
    ]);
    expect(
      (await reader.put(`/api/member/catalog/books/${a.id}/review`).send({ rating: 6 })).status,
    ).toBe(400);

    await reader.delete(`/api/member/catalog/books/${a.id}/review`);
    expect((await reader.get(`/api/member/catalog/books/${a.id}`)).body).toMatchObject({
      ratingAvg: null,
      ratingCount: 0,
    });
  });

  it('shows availability by branch and keeps a wishlist', async () => {
    const { reader, c, b } = await seeded();
    const detail = await reader.get(`/api/member/catalog/books/${c.id}`);
    expect(detail.body.availability).toEqual([{ branchName: 'city main', available: 2 }]);

    expect((await reader.put(`/api/member/catalog/wishlist/${b.id}`)).status).toBe(204);
    await reader.put(`/api/member/catalog/wishlist/${b.id}`);
    const list = await reader.get('/api/member/catalog/wishlist');
    expect(list.body.map((x: { title: string }) => x.title)).toEqual(['Wings of Fire']);
    const search = await reader.get('/api/member/catalog/books?q=wings');
    expect(search.body.items[0].inWishlist).toBe(true);

    await reader.delete(`/api/member/catalog/wishlist/${b.id}`);
    expect((await reader.get('/api/member/catalog/wishlist')).body).toEqual([]);
  });

  it('is closed to members whose ID is not yet approved, and to staff', async () => {
    const { lib, staff } = await seeded();
    await createUser({ libraryId: lib.id, role: 'member', email: 'new@city.test' });
    const newcomer = await signedInAgent(app, 'new@city.test');
    expect((await newcomer.get('/api/member/catalog/books')).status).toBe(403);
    expect((await staff.get('/api/member/catalog/books')).status).toBe(403);
    expect((await request(app).get('/api/member/catalog/books')).status).toBe(401);
  });
});
