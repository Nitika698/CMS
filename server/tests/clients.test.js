import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { app, bearer, request, signUp, useDatabase } from './helpers/app.js';
import { clients, discussions, newClient } from './helpers/clients.js';
import { setTimezone } from './helpers/calendar.js';
import { Client } from '../src/modules/clients/client.model.js';

useDatabase();

const DAY = 86_400_000;
const ymd = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10); // users default to UTC
const names = (res) => res.body.data.map((c) => c.name);

describe('create and read', () => {
  test('creates a brand with sensible defaults, timestamps and no leaked internals', async () => {
    const { token, user } = await signUp();
    const res = await clients.create(token, { name: '  Acme Co  ' });
    assert.equal(res.status, 201);
    const c = res.body.data;
    assert.deepEqual([c.name, c.type, c.status, c.archived], ['Acme Co', 'brand', 'lead', false]);
    assert.deepEqual([c.contacts, c.socialLinks, c.rates, c.primaryContact], [[], [], [], null]);
    assert.ok(c.createdAt && c.updatedAt);
    assert.equal(typeof c.version, 'number');
    assert.equal(c.followUpOverdue, false);
    const text = JSON.stringify(res.body);
    for (const leak of ['owner', 'nameLower', '__v', user.id]) assert.ok(!text.includes(leak), `must not expose ${leak}`);
  });

  test('stores every supported field, normalises links and emails, and picks a primary contact', async () => {
    const { token } = await signUp();
    const res = await clients.create(token, {
      name: 'Glow Beauty',
      type: 'agency',
      status: 'active',
      website: 'glowbeauty.com',
      socialLinks: [
        { platform: 'instagram', url: 'instagram.com/glow' },
        { platform: 'instagram', url: 'https://instagram.com/glow/' }, // duplicate once normalised
        { platform: 'youtube', url: 'https://youtube.com/@glow' },
      ],
      industry: 'Cosmetics',
      category: 'Beauty',
      contacts: [{ name: 'Priya Shah', role: 'Partnerships', email: 'PRIYA@Glow.com', phone: '+91 98765 43210' }, { name: 'Sam Lee', email: 'sam@glow.com' }],
      contactPreferences: { channel: 'whatsapp', bestTime: 'Weekdays after 3pm IST', notes: 'Prefers short voice notes' },
      collaborationNotes: 'Loved the unboxing reel. Wants UGC next quarter.',
      rates: [{ label: 'Instagram reel', amountMinor: 15_000_000, currency: 'inr', unit: 'per_video', notes: 'incl. 1 revision' }],
      defaultCurrency: 'inr',
      paymentTermsDays: 30,
      terms: { exclusivity: '30 days in beauty', usageRights: '6 months paid usage', other: 'Net 30' },
      followUpAt: '2040-06-20',
      followUpNote: 'Send Q3 rate card',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const c = res.body.data;
    assert.equal(c.website, 'https://glowbeauty.com');
    assert.deepEqual(c.socialLinks.map((s) => s.url), ['https://instagram.com/glow', 'https://youtube.com/@glow']);
    assert.deepEqual(c.contacts.map((x) => [x.name, x.email, x.isPrimary]), [['Priya Shah', 'priya@glow.com', true], ['Sam Lee', 'sam@glow.com', false]]);
    assert.equal(c.primaryContact.name, 'Priya Shah');
    assert.deepEqual(c.contactPreferences, { channel: 'whatsapp', bestTime: 'Weekdays after 3pm IST', notes: 'Prefers short voice notes' });
    assert.deepEqual(c.rates.map((r) => [r.label, r.amountMinor, r.currency, r.unit]), [['Instagram reel', 15_000_000, 'INR', 'per_video']]);
    assert.deepEqual([c.defaultCurrency, c.paymentTermsDays], ['INR', 30]);
    assert.equal(c.terms.usageRights, '6 months paid usage');
    assert.equal(c.followUpAt, '2040-06-20T00:00:00.000Z');
    assert.equal(c.followUpNote, 'Send Q3 rate card');
  });

  test('an explicitly chosen primary contact is respected', async () => {
    const { token } = await signUp();
    const c = (await clients.create(token, { contacts: [{ name: 'A' }, { name: 'B', isPrimary: true }] })).body.data;
    assert.equal(c.primaryContact.name, 'B');
  });

  test('GET returns the same detail; unknown and malformed ids are 404', async () => {
    const { token } = await signUp();
    const id = await newClient(token);
    assert.equal((await clients.get(token, id)).body.data.id, id);
    for (const bad of ['507f1f77bcf86cd799439011', 'abc', '123']) assert.equal((await clients.get(token, bad)).status, 404, bad);
  });

  test('meta lists the options plus the user\'s own categories and industries (never another user\'s)', async () => {
    const a = await signUp();
    const b = await signUp();
    await newClient(a.token, { name: 'One', category: 'Pet Care', industry: 'Retail' });
    await newClient(b.token, { name: 'Two', category: 'Secret Category', industry: 'Secret Industry' });
    const m = (await clients.meta(a.token)).body;
    assert.deepEqual(m.statuses, ['lead', 'active', 'past', 'blocked']);
    assert.ok(m.categories.includes('Pet Care') && m.categories.includes('Beauty'));
    assert.ok(!JSON.stringify(m).includes('Secret'));
    assert.deepEqual(m.industries, ['Retail']);
  });
});

describe('update', () => {
  test('edits fields, merges nested objects, clears values with null or empty text, and advances the version', async () => {
    const { token } = await signUp();
    const created = (await clients.create(token, {
      name: 'Acme', website: 'acme.com', industry: 'Tech', followUpAt: '2040-06-20', followUpNote: 'call',
      contactPreferences: { channel: 'email', bestTime: 'mornings' }, terms: { exclusivity: 'none', usageRights: '3 months' },
    })).body.data;
    await new Promise((r) => setTimeout(r, 15));
    const res = await clients.patch(token, created.id, { name: 'Acme Inc', website: '', industry: null, contactPreferences: { channel: 'phone' }, terms: { usageRights: null }, status: 'active', version: created.version });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const c = res.body.data;
    assert.deepEqual([c.name, c.website, c.industry, c.status], ['Acme Inc', null, null, 'active']);
    assert.deepEqual(c.contactPreferences, { channel: 'phone', bestTime: 'mornings', notes: null }, 'unmentioned preference fields survive');
    assert.deepEqual(c.terms, { exclusivity: 'none', usageRights: null, other: null });
    assert.ok(c.version > created.version);
    assert.ok(new Date(c.updatedAt) > new Date(created.updatedAt));
  });

  test('clearing the follow-up date also drops its note', async () => {
    const { token } = await signUp();
    const id = await newClient(token, { followUpAt: '2040-06-20', followUpNote: 'send deck' });
    const c = (await clients.patch(token, id, { followUpAt: null })).body.data;
    assert.deepEqual([c.followUpAt, c.followUpNote], [null, null]);
  });

  test('contacts keep their identity when sent back with their id; removed ones disappear', async () => {
    const { token } = await signUp();
    const created = (await clients.create(token, { contacts: [{ name: 'Ann', email: 'ann@x.com' }, { name: 'Bob' }] })).body.data;
    const [ann, bob] = created.contacts;
    const res = await clients.patch(token, created.id, { contacts: [{ id: ann.id, name: 'Ann Lee', email: 'ann@x.com', isPrimary: true }, { name: 'Cara' }] });
    const names2 = res.body.data.contacts.map((c) => [c.id === ann.id, c.name]);
    assert.deepEqual(names2, [[true, 'Ann Lee'], [false, 'Cara']]);
    assert.ok(!res.body.data.contacts.some((c) => c.id === bob.id));
    const bad = await clients.patch(token, created.id, { contacts: [{ id: '507f1f77bcf86cd799439011', name: 'Ghost' }] });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.details[0].path, 'contacts.0');
  });

  test('an empty patch and forbidden fields are rejected', async () => {
    const { token, user } = await signUp();
    const other = await signUp();
    const c = (await clients.create(token)).body.data;
    assert.equal((await clients.patch(token, c.id, {})).status, 400);
    assert.equal((await clients.patch(token, c.id, { version: c.version })).status, 400);
    for (const body of [{ owner: other.user.id }, { archivedAt: new Date().toISOString() }, { nameLower: 'x' }, { _id: other.user.id }, { campaigns: ['x'] }, { invoices: [] }, { lastContactAt: '2040-01-01' }, { version: '1', name: 'x' }]) {
      assert.equal((await clients.patch(token, c.id, body)).status, 400, JSON.stringify(body));
      assert.equal((await clients.create(token, { name: 'Another', ...body })).status, 400, `create ${JSON.stringify(body)}`);
    }
    assert.equal(String((await Client.findById(c.id)).owner), user.id);
  });

  test('a stale screen cannot overwrite a newer change; simultaneous edits have one winner', async () => {
    const { token } = await signUp();
    const c = (await clients.create(token)).body.data;
    assert.equal((await clients.patch(token, c.id, { status: 'active', version: c.version })).status, 200);
    const stale = await clients.patch(token, c.id, { status: 'past', version: c.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'STALE_VERSION');
    assert.equal((await clients.get(token, c.id)).body.data.status, 'active');

    const fresh = (await clients.get(token, c.id)).body.data;
    const results = await Promise.all(['lead', 'past', 'blocked', 'active'].map((status) => clients.patch(token, c.id, { status, version: fresh.version })));
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 409));
  });
});

describe('validation', () => {
  test('rejects bad input with field-level details and creates nothing', async () => {
    const { token } = await signUp();
    const cases = {
      'missing name': [{ name: undefined }, 'name'],
      'blank name': [{ name: '   ' }, 'name'],
      'name too long': [{ name: 'x'.repeat(121) }, 'name'],
      'bad type': [{ type: 'shop' }, 'type'],
      'bad status': [{ status: 'vip' }, 'status'],
      'bad website': [{ website: 'not a url' }, 'website'],
      'website without a dot': [{ website: 'localhost' }, 'website'],
      'javascript website': [{ website: 'javascript:alert(1)' }, 'website'],
      'bad social link': [{ socialLinks: [{ platform: 'instagram', url: 'nope' }] }, 'socialLinks.0.url'],
      'bad social platform': [{ socialLinks: [{ platform: 'myspace', url: 'https://x.com/a' }] }, 'socialLinks.0.platform'],
      'too many social links': [{ socialLinks: Array.from({ length: 11 }, (_, i) => ({ platform: 'x', url: `https://x.com/u${i}` })) }, 'socialLinks'],
      'contact without a name': [{ contacts: [{ email: 'a@b.com' }] }, 'contacts.0.name'],
      'bad contact email': [{ contacts: [{ name: 'A', email: 'nope' }] }, 'contacts.0.email'],
      'bad phone': [{ contacts: [{ name: 'A', phone: 'abc' }] }, 'contacts.0.phone'],
      'two primary contacts': [{ contacts: [{ name: 'A', isPrimary: true }, { name: 'B', isPrimary: true }] }, 'contacts'],
      'too many contacts': [{ contacts: Array.from({ length: 11 }, (_, i) => ({ name: `C${i}` })) }, 'contacts'],
      'bad preferred channel': [{ contactPreferences: { channel: 'pigeon' } }, 'contactPreferences.channel'],
      'unknown preference key': [{ contactPreferences: { mood: 'x' } }, 'contactPreferences'],
      'rate without a label': [{ rates: [{ label: '', amountMinor: 100, currency: 'USD' }] }, 'rates.0.label'],
      'fractional rate': [{ rates: [{ label: 'Reel', amountMinor: 10.5, currency: 'USD' }] }, 'rates.0.amountMinor'],
      'negative rate': [{ rates: [{ label: 'Reel', amountMinor: -1, currency: 'USD' }] }, 'rates.0.amountMinor'],
      'bad rate currency': [{ rates: [{ label: 'Reel', amountMinor: 100, currency: 'DOLLARS' }] }, 'rates.0.currency'],
      'bad rate unit': [{ rates: [{ label: 'Reel', amountMinor: 100, currency: 'USD', unit: 'per_moon' }] }, 'rates.0.unit'],
      'bad currency': [{ defaultCurrency: 'EURO' }, 'defaultCurrency'],
      'payment terms fractional': [{ paymentTermsDays: 30.5 }, 'paymentTermsDays'],
      'payment terms negative': [{ paymentTermsDays: -1 }, 'paymentTermsDays'],
      'payment terms too long': [{ paymentTermsDays: 366 }, 'paymentTermsDays'],
      'bad follow-up date': [{ followUpAt: 'next week' }, 'followUpAt'],
      'impossible follow-up date': [{ followUpAt: '2040-13-45' }, 'followUpAt'],
      'follow-up note too long': [{ followUpNote: 'x'.repeat(201) }, 'followUpNote'],
      'notes too long': [{ collaborationNotes: 'x'.repeat(20_001) }, 'collaborationNotes'],
      'name as number': [{ name: 42 }, 'name'],
      'contacts not a list': [{ contacts: 'a@b.com' }, 'contacts'],
    };
    for (const [name, [override, path]] of Object.entries(cases)) {
      const res = await request(app).post('/api/v1/clients').set(bearer(token)).send({ name: 'Valid Name', ...override });
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR', name);
      assert.ok(res.body.error.details.some((d) => d.path === path), `${name}: expected "${path}" in ${JSON.stringify(res.body.error.details)}`);
    }
    assert.equal(await Client.countDocuments(), 0);
  });

  test('accepts the full range of valid values at their limits', async () => {
    const { token } = await signUp();
    const res = await clients.create(token, {
      name: 'x'.repeat(120), paymentTermsDays: 0, rates: [{ label: 'Free', amountMinor: 0, currency: 'EUR' }],
      contacts: Array.from({ length: 10 }, (_, i) => ({ name: `C${i}` })), collaborationNotes: 'y'.repeat(20_000), followUpAt: '2040-02-29',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body.error));
  });

  test('a follow-up date accepts a date-time and keeps just the date', async () => {
    const { token } = await signUp();
    const c = (await clients.create(token, { followUpAt: '2040-06-20T23:30:00+05:30' })).body.data;
    assert.equal(c.followUpAt, '2040-06-20T00:00:00.000Z');
  });
});

describe('names are unique per owner among active brands', () => {
  test('case-insensitive duplicates are refused with a pointer to the existing brand', async () => {
    const a = await signUp();
    const b = await signUp();
    const id = await newClient(a.token, { name: 'Acme Co' });
    const dup = await clients.create(a.token, { name: '  ACME co ' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_NAME');
    assert.equal(dup.body.error.details.existingId, id);
    assert.equal(await Client.countDocuments({ owner: a.user.id }), 1);
    assert.equal((await clients.create(b.token, { name: 'Acme Co' })).status, 201, 'another user may use the same name');
  });

  test('renaming into a taken name is refused, but changing only the case of your own name is fine', async () => {
    const { token } = await signUp();
    await newClient(token, { name: 'Alpha' });
    const beta = (await clients.create(token, { name: 'Beta' })).body.data;
    assert.equal((await clients.patch(token, beta.id, { name: 'alpha' })).status, 409);
    assert.equal((await clients.patch(token, beta.id, { name: 'BETA' })).body.data.name, 'BETA');
  });

  test('simultaneous creates of the same name cannot produce two brands', async () => {
    const { token, user } = await signUp();
    const results = await Promise.all(Array.from({ length: 6 }, () => clients.create(token, { name: 'Race Brand' })));
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 409 && r.body.error.code === 'DUPLICATE_NAME'));
    assert.equal(await Client.countDocuments({ owner: user.id }), 1);
  });
});

describe('archiving', () => {
  test('hides a brand from the default list, frees its name, blocks edits, and can be restored', async () => {
    const { token } = await signUp();
    const id = await newClient(token, { name: 'Old Deal' });
    const arch = await clients.archive(token, id);
    assert.equal(arch.status, 200);
    assert.equal(arch.body.data.archived, true);
    assert.deepEqual(arch.body.warnings, []);
    assert.deepEqual(names(await clients.list(token)), []);
    assert.deepEqual(names(await clients.list(token, 'archived=true')), ['Old Deal']);

    const edit = await clients.patch(token, id, { status: 'past' });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'ARCHIVED');
    assert.equal((await clients.archive(token, id)).status, 200, 'idempotent');

    assert.equal((await clients.create(token, { name: 'old deal' })).status, 201, 'the freed name can be reused');
    const restore = await clients.restore(token, id);
    assert.equal(restore.status, 409, 'but then the archived one cannot come back under the same name');
    assert.equal(restore.body.error.code, 'DUPLICATE_NAME');
  });

  test('restores cleanly when the name is still free', async () => {
    const { token } = await signUp();
    const id = await newClient(token, { name: 'Comeback' });
    await clients.archive(token, id);
    const res = await clients.restore(token, id);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.archived, false);
    assert.deepEqual(names(await clients.list(token)), ['Comeback']);
  });
});

describe('list: search, filter, sort, pagination', () => {
  async function seed() {
    const a = await signUp();
    const mk = (body) => clients.create(a.token, body).then((r) => r.body.data);
    const acme = await mk({ name: 'acme tools', type: 'brand', status: 'active', category: 'Tech', industry: 'Hardware', website: 'acme.com', contacts: [{ name: 'Wile Coyote', email: 'wile@acme.com' }], followUpAt: ymd(-3), followUpNote: 'overdue one' });
    const bravo = await mk({ name: 'Bravo Beauty', type: 'brand', status: 'lead', category: 'Beauty', industry: 'Cosmetics', socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/bravo' }], collaborationNotes: 'Loves minimalist packaging', followUpAt: ymd(5) });
    const charlie = await mk({ name: 'Charlie Agency', type: 'agency', status: 'past', category: 'Media', industry: 'Marketing' });
    const delta = await mk({ name: 'Delta (Foods)', type: 'brand', status: 'blocked', category: 'beauty', industry: 'Food', followUpAt: ymd(0) });
    const echo = await mk({ name: 'Echo', type: 'individual', status: 'active', category: 'Tech' });
    const archived = await mk({ name: 'Zulu Archive', status: 'past' });
    await clients.archive(a.token, archived.id);
    return { a, ids: { acme: acme.id, bravo: bravo.id, charlie: charlie.id, delta: delta.id, echo: echo.id } };
  }

  test('search matches name, contacts, industry, category, website, social links and notes, case-insensitively', async () => {
    const { a } = await seed();
    const q = (term) => clients.list(a.token, `q=${encodeURIComponent(term)}`);
    assert.deepEqual(names(await q('ACME')), ['acme tools']);
    assert.deepEqual(names(await q('coyote')), ['acme tools']); // contact name
    assert.deepEqual(names(await q('wile@acme')), ['acme tools']); // contact email
    assert.deepEqual(names(await q('cosmetics')), ['Bravo Beauty']); // industry
    assert.deepEqual((names(await q('beauty'))).sort(), ['Bravo Beauty', 'Delta (Foods)']); // category (either case)
    assert.deepEqual(names(await q('instagram.com/bravo')), ['Bravo Beauty']); // social link
    assert.deepEqual(names(await q('minimalist')), ['Bravo Beauty']); // collaboration notes
    assert.deepEqual(names(await q('zzzz')), []);
  });

  test('search text is literal, never a regular expression', async () => {
    const { a } = await seed();
    assert.deepEqual(names(await clients.list(a.token, `q=${encodeURIComponent('(Foods)')}`)), ['Delta (Foods)']);
    for (const t of ['(', '[a-', '\\', '(a+)+$', '.*', '?']) {
      const res = await clients.list(a.token, `q=${encodeURIComponent(t)}`);
      assert.equal(res.status, 200, t);
    }
    assert.deepEqual(names(await clients.list(a.token, `q=${encodeURIComponent('.*')}`)), []);
  });

  test('filters by status, type, category, industry and archive state, and they combine', async () => {
    const { a } = await seed();
    const q = (s) => clients.list(a.token, s);
    assert.deepEqual(names(await q('status=active&sort=name')), ['acme tools', 'Echo']);
    assert.deepEqual(names(await q('status=lead,past&sort=name')), ['Bravo Beauty', 'Charlie Agency']);
    assert.deepEqual(names(await q('type=agency')), ['Charlie Agency']);
    assert.deepEqual(names(await q('category=tech&sort=name')), ['acme tools', 'Echo']); // exact, case-insensitive
    assert.deepEqual(names(await q('category=beauty&sort=name')), ['Bravo Beauty', 'Delta (Foods)']);
    assert.deepEqual(names(await q('industry=Food')), ['Delta (Foods)']);
    assert.deepEqual(names(await q('status=active&category=Tech&type=individual')), ['Echo']);
    assert.deepEqual(names(await q('archived=true')), ['Zulu Archive']);
    assert.equal((await q('')).body.meta.total, 5, 'archived brands are excluded by default');
  });

  test('follow-up filter separates overdue, upcoming (today included) and none', async () => {
    const { a } = await seed();
    const q = (f) => clients.list(a.token, `followUp=${f}&sort=name`);
    assert.deepEqual(names(await q('overdue')), ['acme tools']);
    assert.deepEqual(names(await q('upcoming')), ['Bravo Beauty', 'Delta (Foods)']); // due today is not overdue
    assert.deepEqual(names(await q('none')), ['Charlie Agency', 'Echo']);
    const items = Object.fromEntries((await clients.list(a.token)).body.data.map((c) => [c.name, c.followUpOverdue]));
    assert.deepEqual([items['acme tools'], items['Delta (Foods)'], items.Echo], [true, false, false]);
  });

  test('"today" for follow-ups follows the user\'s timezone', async () => {
    const { token } = await signUp();
    await setTimezone(token, 'Pacific/Kiritimati'); // UTC+14: it is often already tomorrow there
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
    const yesterday = new Date(Date.parse(`${local}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
    await newClient(token, { name: 'Due today there', followUpAt: local });
    await newClient(token, { name: 'Due yesterday there', followUpAt: yesterday });
    assert.deepEqual(names(await clients.list(token, 'followUp=overdue')), ['Due yesterday there']);
  });

  test('sorts by name (case-insensitive), workflow status, follow-up date with blanks last, and recency', async () => {
    const { a } = await seed();
    const order = async (s) => names(await clients.list(a.token, `sort=${s}`));
    assert.deepEqual(await order('name'), ['acme tools', 'Bravo Beauty', 'Charlie Agency', 'Delta (Foods)', 'Echo']);
    assert.deepEqual(await order('-name'), ['Echo', 'Delta (Foods)', 'Charlie Agency', 'Bravo Beauty', 'acme tools']);
    assert.deepEqual((await order('status')).slice(0, 2), ['Bravo Beauty', 'acme tools']); // lead, then the active ones
    assert.equal((await order('status')).at(-1), 'Delta (Foods)'); // blocked last
    assert.deepEqual((await order('followUpAt')).slice(0, 3), ['acme tools', 'Delta (Foods)', 'Bravo Beauty']);
    assert.deepEqual((await order('-followUpAt')).slice(0, 3), ['Bravo Beauty', 'Delta (Foods)', 'acme tools']);
    for (const s of ['followUpAt', '-followUpAt']) assert.deepEqual(new Set((await order(s)).slice(3)), new Set(['Charlie Agency', 'Echo']), `${s}: blanks last`);
    await new Promise((r) => setTimeout(r, 15));
    await clients.patch(a.token, (await clients.list(a.token, 'q=Echo')).body.data[0].id, { industry: 'Audio' });
    assert.equal((await order('-updatedAt'))[0], 'Echo');
  });

  test('sorts by last contact, which comes from saved discussions; brands never contacted sort last', async () => {
    const { a, ids } = await seed();
    await discussions.create(a.token, ids.bravo, { occurredAt: new Date(Date.now() - 10 * DAY).toISOString() });
    await discussions.create(a.token, ids.echo, { occurredAt: new Date(Date.now() - 2 * DAY).toISOString() });
    await discussions.create(a.token, ids.echo, { occurredAt: new Date(Date.now() - 30 * DAY).toISOString() });
    const order = async (s) => (await clients.list(a.token, `sort=${s}`)).body.data;
    const desc = await order('-lastContact');
    assert.deepEqual(desc.slice(0, 2).map((c) => c.name), ['Echo', 'Bravo Beauty']);
    const asc = await order('lastContact');
    assert.deepEqual(asc.slice(0, 2).map((c) => c.name), ['Bravo Beauty', 'Echo']);
    for (const list of [desc, asc]) assert.deepEqual(list.slice(2).map((c) => c.lastContactAt), [null, null, null], 'never contacted: last');
    const echo = desc[0];
    assert.equal(echo.communicationCount, 2);
    assert.ok(Math.abs(new Date(echo.lastContactAt) - (Date.now() - 2 * DAY)) < 60_000);
  });

  test('paginates with accurate meta, stable order and no duplicates', async () => {
    const { token } = await signUp();
    for (let i = 1; i <= 12; i++) await newClient(token, { name: `Brand ${String(i).padStart(2, '0')}` });
    const pages = await Promise.all([1, 2, 3].map((p) => clients.list(token, `limit=5&page=${p}`)));
    assert.deepEqual(pages[0].body.meta, { page: 1, limit: 5, total: 12, pages: 3 });
    assert.deepEqual(pages.map((r) => r.body.data.length), [5, 5, 2]);
    const all = pages.flatMap((r) => names(r));
    assert.equal(new Set(all).size, 12);
    assert.deepEqual(all, [...all].sort());
    const beyond = await clients.list(token, 'limit=5&page=9');
    assert.deepEqual([beyond.status, beyond.body.data, beyond.body.meta.total], [200, [], 12]);
  });

  test('rejects out-of-range paging, unknown sorts and unknown filter values', async () => {
    const { token } = await signUp();
    for (const q of ['limit=101', 'limit=0', 'page=0', 'page=abc', 'sort=owner', 'sort=-password', 'status=vip', 'type=shop', 'followUp=soon', 'archived=maybe']) {
      assert.equal((await clients.list(token, q)).status, 400, q);
    }
  });

  test('list rows are summaries with the primary contact, active campaigns and last contact', async () => {
    const { a, ids } = await seed();
    const row = (await clients.list(a.token, 'q=acme')).body.data[0];
    assert.equal(row.id, ids.acme);
    assert.deepEqual([row.primaryContact.name, row.primaryContact.email, row.contactCount], ['Wile Coyote', 'wile@acme.com', 1]);
    assert.deepEqual([row.activeCampaigns, row.lastContactAt, row.communicationCount], [0, null, 0]);
    assert.equal(row.collaborationNotes, undefined);
    assert.equal(row.rates, undefined);
  });
});
