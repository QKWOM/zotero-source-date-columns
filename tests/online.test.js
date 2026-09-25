const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const scope = { URL, URLSearchParams };
vm.runInNewContext(readFileSync(path.join(__dirname, '../online.js'), 'utf8'), scope);
const api = scope.SourceDateOnline;
const title = 'SpatialVLA: Exploring Spatial Representations for Visual-Language-Action Model';
const input = { id: 4, title, authors: ['Qu', 'Song'], year: 2025, doi: '', arxiv: '',
  localSource: 'arXiv', localDate: '2025-01' };
const work = { DOI: '10.15607/rss.2025.xxi.011', title: [title + 's'],
  type: 'proceedings-article', event: { name: 'Robotics: Science and Systems 2025' },
  author: [{ family: 'Qu' }, { family: 'Song' }], 'published-online': { 'date-parts': [[2025, 6, 21]] } };
assert.equal(api.chooseWork(input, [work]).result.date, '2025-06');
assert.equal(api.chooseWork({ ...input, authors: ['Smith'] }, [work]).result, null);
assert.equal(api.chooseWork({ ...input, authors: [] }, [work]).result, null);
assert.equal(api.chooseWork(input, [work, { ...work, DOI: '10.1234/other' }]).ambiguous, true);
assert.equal(api.chooseWork(input, [{ ...work, type: 'posted-content' }]).result, null);
assert.equal(api.chooseWork({ ...input, title: 'A completely unrelated robotics paper' }, [work]).result, null);
assert.equal(api.chooseWork({ ...input, year: 2030 }, [work]).result, null);
assert.equal(api.formalRecord({ ...work, event: { name: 'RSS', start: { 'date-parts': [[2025, 7, 1]] } } }).date, '2025-07');
assert.equal(api.formalRecord({ ...work, 'published-online': undefined, created: { 'date-parts': [[2026, 5]] } }).date, '');
assert.equal(api.yearMonth({ 'date-parts': [[2025]] }), '2025');
assert.equal(api.arxivID('https://arxiv.org/abs/2501.15830v5'), '2501.15830');
assert.equal(api.arxivID('https://arxiv.org/abs/hep-th/9901001v2'), 'hep-th/9901001');
assert.equal(api.doi('https://doi.org/10.15607/RSS.2025.XXI.011'), work.DOI);
assert.equal(api.plainTitle('$π_{0.5}$: a Vision-Language-Action Model'), 'π0.5: a Vision-Language-Action Model');
assert.equal(api.arxivTitleQuery('π0.5: a Vision-Language-Action Model with Open-World Generalization'),
  'ti:"a Vision-Language-Action Model with Open-World Generalization"');
assert.equal(api.arxivTitleQuery('Mobi-π: Mobilizing Your Robot Learning Policy'),
  'ti:"Mobilizing Your Robot Learning Policy"');
assert.equal(api.arxivTitleQuery('RoboTwin: Dual-Arm Robots'), 'ti:"RoboTwin Dual-Arm Robots"');

// Minimal Atom document stub: enough of the DOM API used by parseArxivEntries.
function atom(entries) {
  const node = (text, children = {}) => ({ textContent: text,
    getElementsByTagNameNS: (_, tag) => children[tag] || [] });
  const entry = e => node('', { id: [node('http://arxiv.org/abs/' + e.id + 'v2')], title: [node(e.title)],
    published: [node(e.published + '-29T00:00:00Z')], doi: e.doi ? [node(e.doi)] : [], journal_ref: [],
    comment: e.comment ? [node(e.comment)] : [],
    author: e.authors.map(a => node('', { name: [node(a)] })) });
  return { getElementsByTagName: () => [], getElementsByTagNameNS: (_, tag) => tag === 'entry' ? entries.map(entry) : [] };
}
const pi = { id: '2504.16054', title: '$π_{0.5}$: a Vision-Language-Action Model with Open-World Generalization',
  published: '2025-04', authors: ['Kevin Black', 'Noah Brown'] };
const piInput = { id: 20, title: 'π0.5: a Vision-Language-Action Model with Open-World Generalization',
  authors: ['Black', 'Brown'], year: 0, doi: '', arxiv: '', localSource: '', localDate: '' };
assert.equal(api.chooseArxiv(piInput, api.parseArxivEntries(atom([pi]))).id, pi.id);
const venue = (note, up = '2025-05') => { const v = api.venueFromNote(note, up); return v ? v.name + ' ' + v.year : null; };
assert.equal(venue('CoRL 2025. Project website: https://mobipi.github.io/'), 'Conference on Robot Learning (CoRL) 2025');
assert.equal(venue('Accepted to ICRA\'26'), 'IEEE International Conference on Robotics and Automation (ICRA) 2026');
assert.equal(venue('NeurIPS 2025 (Spotlight), 20 pages'), 'Conference on Neural Information Processing Systems (NeurIPS) 2025');
assert.equal(venue('Under review at CoRL 2025'), null);
assert.equal(venue('CoRL 2025 Workshop on Mobile Manipulation'), null);
assert.equal(venue('Accepted at RSS 2025; extended version of ICRA 2024 paper'), null, 'two venues: ambiguous');
assert.equal(venue('CoRL 2019'), null, 'year far from upload date');
assert.equal(venue('Uses the ACLED dataset from 2025'), null);
assert.equal(venue('12 pages, 8 figures'), null);
assert.equal(api.plainTitle('Mobi-$\\pi$: Mobilizing Your Robot Learning Policy'), 'Mobi-π: Mobilizing Your Robot Learning Policy');
const orNote = (title, venue, venueid, authors) => ({ forum: 'abc', content: { title: { value: title },
  venue: { value: venue }, venueid: { value: venueid }, authors: { value: authors } } });
const orVenue = (venue, id = 'robot-learning.org/CoRL/2025/Conference') => {
  const v = api.openReviewVenue(orNote('t', venue, id, [])); return v ? v.source + ' ' + v.year : null; };
assert.equal(orVenue('CoRL 2025 Poster'), 'Conference on Robot Learning (CoRL) 2025');
assert.equal(orVenue('CVPR 2026', 'thecvf.com/CVPR/2026/Conference'),
  'IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR) 2026');
assert.equal(orVenue('RLC 2025', 'rl-conference.cc/RLC/2025/Conference'), 'RLC 2025');
assert.equal(orVenue('ICLR 2025 Conference Withdrawn Submission', 'ICLR.cc/2025/Conference/Withdrawn_Submission'), null);
assert.equal(orVenue('Submitted to ICLR 2026', 'ICLR.cc/2026/Conference/Submission'), null);
assert.equal(orVenue('CoRL 2025 Robot Data Workshop', 'robot-learning.org/CoRL/2025/Workshop/Robot_Data'), null);
assert.equal(orVenue('CoRR 2025', 'dblp.org/journals/CORR/2025'), null);
assert.equal(orVenue('Accepted by TMLR', 'TMLR'), null, 'no year: skip');
assert.equal(api.openReviewTerm('Affordance Field Intervention: Enabling VLAs to Escape Memory Traps in Robotic Manipulation'),
  'Enabling VLAs Escape Memory Traps Robotic Manipulation');
assert.equal(api.openReviewTerm('π0.5: a Vision-Language-Action Model with Open-World Generalization'),
  'Vision-Language-Action Model Open-World Generalization');
const mobiInput = { title: 'Mobi-π: Mobilizing Your Robot Learning Policy', authors: ['Yang', 'Huang'] };
const mobiNotes = [orNote('Mobi-$\\pi$: Mobilizing Your Robot Learning Policy', 'CoRL 2025 Poster',
    'robot-learning.org/CoRL/2025/Conference', ['Jingyun Yang', 'Isabella Huang']),
  orNote('Mobi-$\\pi$: Mobilizing Your Robot Learning Policy', 'CoRR 2025', 'dblp.org/journals/CORR/2025', ['Jingyun Yang']),
  orNote('Scale Your Dataset Without Robot', 'CoRL 2025 Poster', 'robot-learning.org/CoRL/2025/Conference', ['A Yang'])];
assert.equal(api.chooseOpenReview(mobiInput, mobiNotes).source, 'Conference on Robot Learning (CoRL)');
assert.equal(api.chooseOpenReview({ ...mobiInput, authors: ['Smith'] }, mobiNotes), null);
assert.equal(api.chooseOpenReview(mobiInput, [...mobiNotes, orNote(mobiInput.title, 'IJRR 2026', 'IJRR', ['Jingyun Yang'])]),
  null, 'two accepted venues: ambiguous');
assert.equal(api.chooseArxiv({ ...piInput, authors: ['Smith'] }, api.parseArxivEntries(atom([pi]))), null);
assert.equal(api.chooseArxiv({ ...piInput, title: 'An unrelated robot learning paper title' },
  api.parseArxivEntries(atom([pi]))), null);

function environment(respond) {
  const calls = [], changes = [], writes = [];
  let time = 1000000000;
  return { calls, changes, writes, now: () => time, advance: ms => { time += ms; },
    sleep: async ms => { time += ms; }, request: async (url, xml) => { calls.push([url, time]); return respond(url, xml); },
    read: async () => null, write: async data => { writes.push(JSON.parse(JSON.stringify(data))); },
    getAuto: () => true, setAuto: () => {}, log: e => { throw e; }, changed: async id => { changes.push(id); } };
}
async function main() {
  const env = environment(() => ({ status: 200, body: { message: { items: [work] } } }));
  const engine = api.create(env); await engine.init();
  const p = engine.enqueue(input), duplicate = engine.enqueue(input);
  assert.equal(p, duplicate);
  assert.equal((await p).state, 'matched');
  assert.equal(env.calls.length, 1);
  await engine.enqueue(input); assert.equal(env.calls.length, 1, 'fresh cache avoids network');
  await engine.enqueue(input, true); assert.equal(env.calls.length, 2);
  assert.ok(env.calls[1][1] - env.calls[0][1] >= 3100, 'request spacing');
  const resumed = api.create({ ...env, read: async () => env.writes.at(-1) });
  await resumed.init(); await resumed.enqueue(input);
  assert.equal(env.calls.length, 2, 'cache survives restart'); await resumed.stop();
  env.advance(8 * 86400000);
  env.request = async () => { throw new Error('offline'); };
  const failed = await engine.enqueue(input);
  assert.equal(failed.state, 'error'); assert.equal(failed.result.source, work.event.name);
  engine.setAuto(false); await engine.enqueue({ ...input, id: 5 });
  assert.equal(engine.snapshot({ ...input, id: 5 }).checkedAt, undefined);
  await engine.stop();

  const directEnv = environment(() => ({ status: 200, body: { message: work } }));
  const direct = api.create(directEnv); await direct.init();
  assert.equal((await direct.enqueue({ ...input, doi: work.DOI })).result.method, '条目 DOI 精确匹配');
  assert.equal(directEnv.calls.length, 1); await direct.stop();

  const rateEnv = environment(() => ({ status: 429, retryAfter: '120' }));
  const rate = api.create(rateEnv); await rate.init();
  assert.equal((await rate.enqueue(input)).state, 'error');
  const crossrefCalls = () => rateEnv.calls.filter(([url]) => url.includes('crossref')).length;
  await rate.enqueue({ ...input, id: 6 }, true);
  assert.equal(crossrefCalls(), 1, '429 blocks further requests for the host');
  rateEnv.advance(121000); await rate.enqueue(input, true);
  assert.equal(crossrefCalls(), 2); await rate.stop();

  let release;
  const slowEnv = environment(() => new Promise(resolve => { release = resolve; }));
  const slow = api.create(slowEnv); await slow.init();
  const inflight = slow.enqueue(input);
  const queued = slow.enqueue({ ...input, id: 10 });
  await new Promise(resolve => setImmediate(resolve));
  await slow.stop(); release({ status: 200, body: { message: { items: [work] } } });
  await Promise.all([inflight, queued]);
  assert.equal(slowEnv.writes.length, 0, 'unloaded plugin does not write or refresh');
  assert.equal(slowEnv.calls.length, 1);
  // arXiv-only paper without an ID in Zotero: Crossref misses, arXiv title search finds it.
  const arxivEnv = environment((url, xml) => xml ? { status: 200, body: atom([pi]) }
    : { status: 200, body: { message: { items: [] } } });
  const arxivEngine = api.create(arxivEnv); await arxivEngine.init();
  const found = await arxivEngine.enqueue(piInput);
  assert.equal(found.state, 'unmatched');
  assert.equal(found.arxivDate, '2025-04'); assert.equal(found.arxivID, pi.id);
  assert.match(arxivEnv.calls[1][0], /search_query=ti%3A%22a\+Vision-Language-Action/);
  await arxivEngine.stop();

  // CoRL is published in PMLR (no Crossref DOI); the arXiv comment names the venue.
  const mobiEnv = environment((url, xml) => xml ? { status: 200, body: atom([{ ...pi, comment: 'CoRL 2025. Project website' }]) }
    : { status: 200, body: { message: { items: [] } } });
  const mobi = api.create(mobiEnv); await mobi.init();
  const corl = await mobi.enqueue(piInput);
  assert.equal(corl.state, 'matched');
  assert.equal(corl.result.source, 'Conference on Robot Learning (CoRL)'); assert.equal(corl.result.date, '2025');
  assert.equal(corl.arxivDate, '2025-04'); await mobi.stop();

  // Nothing in Crossref or arXiv; OpenReview is unavailable once, then names the venue.
  let unavailable = 1;
  const orEnv = environment((url, xml) => xml ? { status: 200, body: atom([pi]) }
    : url.includes('openreview') ? (unavailable-- > 0 ? { status: 200, body: { notes: [], searchUnavailable: true } }
      : { status: 200, body: { notes: mobiNotes } })
    : { status: 200, body: { message: { items: [] } } });
  const orEngine = api.create(orEnv); await orEngine.init();
  const orFound = await orEngine.enqueue({ ...piInput, title: mobiInput.title, authors: mobiInput.authors });
  assert.equal(orFound.state, 'matched'); assert.equal(orFound.result.provider, 'OpenReview');
  assert.equal(orFound.result.date, '2025'); assert.equal(orFound.result.url, 'https://openreview.net/forum?id=abc');
  assert.equal(orEnv.calls.filter(([u]) => u.includes('openreview')).length, 2);
  await orEngine.stop();

  // OpenReview stays unavailable: the lookup is not an error, and retries in an hour.
  const downEnv = environment((url, xml) => xml ? { status: 200, body: atom([]) }
    : url.includes('openreview') ? { status: 200, body: { notes: [], searchUnavailable: true } }
    : { status: 200, body: { message: { items: [] } } });
  const down = api.create(downEnv); await down.init();
  const downResult = await down.enqueue(piInput);
  assert.equal(downResult.state, 'unmatched'); assert.equal(downResult.incomplete, true);
  downEnv.advance(3600001); const before = downEnv.calls.length; await down.enqueue(piInput);
  assert.ok(downEnv.calls.length > before, 'incomplete lookups are retried after an hour');
  await down.stop();

  // A dropped connection is retried once; the second attempt succeeds.
  let drops = 1;
  const flakyEnv = environment(() => {
    if (drops-- > 0) throw new Error('Request timed out after 30000 ms');
    return { status: 200, body: { message: { items: [work] } } };
  });
  const flaky = api.create(flakyEnv); await flaky.init();
  assert.equal((await flaky.enqueue(input)).state, 'matched');
  assert.equal(flakyEnv.calls.length, 2); await flaky.stop();

  // 1.1.0 cache: keep verified matches, discard misses/failures so they are retried.
  const legacy = api.create({ ...environment(() => ({ status: 500 })), read: async () => ({ version: 3,
    records: { a: { state: 'matched', checkedAt: 1 }, b: { state: 'error', checkedAt: 1 } } }) });
  await legacy.init();
  assert.equal(legacy.snapshot(input).state, undefined); await legacy.stop();

  console.log('Online matching, caching, rate-limit and shutdown tests passed.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
