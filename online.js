/* Network lookup and matching. No Zotero item fields are modified. */
var SourceDateOnline = (() => {
  const DAY = 86400000;
  const norm = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '')
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const doi = value => (String(value || '').match(/10\.\d{4,9}\/[^\s<>]+/i)?.[0] || '')
    .replace(/[.,;]+$/, '').toLowerCase();
  const isFormalDOI = value => value && !value.startsWith('10.48550/arxiv.');

  function arxivID(value) {
    const m = String(value || '').match(/(?:^|[^\d])(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?(?=$|[^\d])/i);
    return m ? m[1] : '';
  }

  function yearMonth(parts) {
    const a = parts?.['date-parts']?.[0];
    if (!a || !Number.isInteger(a[0]) || a[0] < 1000 || a[0] > 2999) return '';
    return String(a[0]) + (Number.isInteger(a[1]) && a[1] >= 1 && a[1] <= 12
      ? '-' + String(a[1]).padStart(2, '0') : '');
  }

  function formalRecord(work, method) {
    if (!['journal-article', 'proceedings-article'].includes(work?.type)) return null;
    const conference = work.type === 'proceedings-article';
    const source = String((conference && work.event?.name) || work['container-title']?.[0] || '').trim();
    const id = doi(work.DOI);
    if (!source || /arxiv|biorxiv|medrxiv|preprints/i.test(source) || !isFormalDOI(id)) return null;
    const eventDate = conference ? yearMonth(work.event?.start) : '';
    const date = eventDate || yearMonth(work['published-print']) || yearMonth(work['published-online'])
      || yearMonth(work.published) || yearMonth(work.issued);
    return { source, date, kind: conference ? 'conference' : 'journal', doi: id,
      url: 'https://doi.org/' + id, provider: 'Crossref', method,
      dateBasis: eventDate ? '会议开始年月' : conference ? '出版年月（会议无会期时使用出版日期）' : '期刊出版年月' };
  }

  function titleScore(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    const aa = new Set(a.split(' ')), bb = new Set(b.split(' '));
    const tokens = [...aa].filter(x => bb.has(x)).length / new Set([...aa, ...bb]).size;
    // Small spelling/plural changes between preprint and proceedings are common.
    // Require close character agreement AND substantial word overlap.
    if (tokens >= 0.8 && Math.max(a.length, b.length) <= 2000) {
      let row = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1,
          row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        row = next;
      }
      const chars = 1 - row[b.length] / Math.max(a.length, b.length);
      if (chars >= 0.97) return Math.max(tokens, chars);
    }
    return tokens;
  }

  function chooseWork(input, works) {
    const matches = [];
    for (const work of works || []) {
      const result = formalRecord(work, '标题与作者匹配');
      if (!result) continue;
      const score = Math.max(0, ...(work.title || []).map(title => titleScore(input.title, title)));
      const authors = (work.author || []).map(a => norm(a.family)).filter(Boolean);
      const local = input.authors.map(norm).filter(Boolean);
      // Exact title is still not sufficient when author metadata is absent.
      const overlap = new Set(local.filter(name => authors.includes(name))).size;
      if (!overlap || score < 0.94 || norm(input.title).length < 20) continue;
      if (score < 1 && (norm(input.title).split(' ').length < 8 || overlap < 2)) continue;
      const y = Number(result.date.slice(0, 4));
      if (input.year && y && (y < input.year - 1 || y > input.year + 6)) continue;
      if (!matches.some(x => x.doi === result.doi)) matches.push(result);
    }
    // Multiple credible versions require human review; never select the first hit blindly.
    return { result: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1 };
  }

  // arXiv/OpenReview titles may carry TeX markup such as $π_{0.5}$ or $\pi$; Zotero titles usually do not.
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
    pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω' };
  const plainTitle = value => String(value || '').replace(/\\([a-z]+)(?![a-z])/gi, (m, w) => GREEK[w.toLowerCase()] || m)
    .replace(/[$\\{}]|_(?=\{|\w)/g, '').replace(/\s+/g, ' ').trim();

  function parseArxivEntries(doc) {
    if (!doc || doc.getElementsByTagName('parsererror').length) throw new Error('arXiv 返回无效 XML');
    const atom = 'http://www.w3.org/2005/Atom';
    const ns = 'http://arxiv.org/schemas/atom';
    const entries = [...doc.getElementsByTagNameNS(atom, 'entry')];
    if (entries.some(e => /api\/errors/.test(e.getElementsByTagNameNS(atom, 'id')[0]?.textContent || ''))) {
      throw new Error('arXiv API 返回查询错误');
    }
    return entries.map(entry => {
      const get = (namespace, tag) => entry.getElementsByTagNameNS(namespace, tag)[0]?.textContent?.trim() || '';
      return { id: arxivID(get(atom, 'id')), title: plainTitle(get(atom, 'title')), doi: doi(get(ns, 'doi')),
        published: get(atom, 'published').slice(0, 7), journalRef: get(ns, 'journal_ref'),
        comment: get(ns, 'comment'),
        authors: [...entry.getElementsByTagNameNS(atom, 'author')].map(a =>
          a.getElementsByTagNameNS(atom, 'name')[0]?.textContent?.trim().split(/\s+/).pop()).filter(Boolean) };
    });
  }

  function parseArxiv(doc, expectedID) {
    return parseArxivEntries(doc).find(e => e.id === expectedID) || null;
  }

  // Phrase query on the most distinctive part of the title. The part after a
  // colon avoids acronyms/symbols (e.g. "π0.5:") that arXiv tokenizes differently.
  function arxivTitleQuery(title) {
    const text = plainTitle(title).replace(/["()]/g, ' ');
    const parts = text.split(':');
    const tail = parts.slice(1).join(':').trim();
    const phrase = tail.split(/\s+/).length >= 4 ? tail : text;
    return 'ti:"' + phrase.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim() + '"';
  }

  // Venues that publish outside Crossref (PMLR, OpenReview, RSS) are often only
  // recorded in the author's arXiv comment, e.g. "CoRL 2025. Project website: ...".
  const VENUES = [
    ['CoRL|Conference on Robot Learning', 'Conference on Robot Learning (CoRL)'],
    ['RSS|Robotics:? Science and Systems', 'Robotics: Science and Systems (RSS)'],
    ['ICLR|International Conference on Learning Representations', 'International Conference on Learning Representations (ICLR)'],
    ['NeurIPS|NIPS', 'Conference on Neural Information Processing Systems (NeurIPS)'],
    ['ICML|International Conference on Machine Learning', 'International Conference on Machine Learning (ICML)'],
    ['CVPR', 'IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)'],
    ['ICCV', 'IEEE/CVF International Conference on Computer Vision (ICCV)'],
    ['ECCV', 'European Conference on Computer Vision (ECCV)'],
    ['ICRA', 'IEEE International Conference on Robotics and Automation (ICRA)'],
    ['IROS', 'IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)'],
    ['AAAI', 'AAAI Conference on Artificial Intelligence (AAAI)'],
    ['IJCAI', 'International Joint Conference on Artificial Intelligence (IJCAI)'],
    ['ACL', 'Annual Meeting of the Association for Computational Linguistics (ACL)'],
    ['EMNLP', 'Conference on Empirical Methods in Natural Language Processing (EMNLP)'],
    ['HRI', 'ACM/IEEE International Conference on Human-Robot Interaction (HRI)'],
  ];
  function venueFromNote(text, uploaded) {
    const note = String(text || '').replace(/\s+/g, ' ');
    // Submissions, reviews and workshops are not the formal venue.
    if (!note || /workshop|submitted|submission|under review|in review|rejected/i.test(note)) return null;
    const found = new Map();
    for (const [pattern, name] of VENUES) {
      const re = new RegExp(`(?:^|[^\\p{L}])(?:${pattern})(?![\\p{L}])[^.;,\\d]{0,12}?(?:(20\\d{2})|'(\\d{2}))(?!\\d)`, 'giu');
      for (const m of note.matchAll(re)) found.set(name + '|' + (m[1] || '20' + m[2]), { name, year: m[1] || '20' + m[2] });
    }
    if (found.size !== 1) return null;
    const venue = [...found.values()][0], up = Number(String(uploaded).slice(0, 4));
    if (up && (Number(venue.year) < up - 1 || Number(venue.year) > up + 2)) return null;
    return venue;
  }

  // OpenReview venues look like "CoRL 2025 Poster", "CVPR 2026", "ICLR 2025 Conference
  // Withdrawn Submission" or DBLP imports such as "NeurIPS 2023" / "CoRR 2025".
  function openReviewVenue(note) {
    const value = key => note?.content?.[key]?.value;
    const venue = String(value('venue') || '').replace(/\s+/g, ' ').trim();
    const venueID = String(value('venueid') || '');
    if (!venue || /withdrawn|reject|submi|under review|anonymous|workshop|tiny paper|blog ?post|corr\b|arxiv/i.test(venue + ' ' + venueID)) return null;
    const year = venue.match(/\b(20\d{2})\b/)?.[1];
    if (!year) return null;
    const known = venueFromNote(venue.replace(/\b(poster|oral|spotlight|highlight|conference|main track)\b/gi, ''), '');
    const source = known?.name || venue.replace(/\s*\b(20\d{2})\b.*$/, '').trim();
    return source ? { source, year } : null;
  }

  // OpenReview answers "searchUnavailable" whenever the term contains a stopword
  // ("a", "for", "with", ...), so search with content words only.
  const STOPWORDS = new Set(('a an and are as at be by for from in into is it of on or than that the their '
    + 'this to via vs we what when where which while who why with without your our can do does how not').split(' '));
  function openReviewTerm(title) {
    return arxivTitleQuery(title).slice(4, -1).split(' ')
      .filter(word => word && !STOPWORDS.has(word.toLowerCase())).slice(0, 10).join(' ');
  }

  function chooseOpenReview(input, notes) {
    const local = input.authors.map(norm).filter(Boolean);
    const matches = new Map();
    for (const note of notes || []) {
      const value = key => note?.content?.[key]?.value;
      const venue = openReviewVenue(note);
      if (!venue) continue;
      const score = titleScore(plainTitle(input.title), plainTitle(value('title')));
      const authors = (value('authors') || []).map(a => norm(String(a?.fullname || a?.name || a)
        .trim().split(/\s+/).pop()));
      const overlap = authors.filter(name => local.includes(name)).length;
      if (!overlap || score < 0.94 || norm(input.title).length < 20) continue;
      matches.set(venue.source + '|' + venue.year, { ...venue, id: note.forum || note.id || '' });
    }
    // Several accepted venues (e.g. conference + journal extension) need human review.
    return matches.size === 1 ? [...matches.values()][0] : null;
  }

  function chooseArxiv(input, entries) {
    const local = input.authors.map(norm).filter(Boolean);
    const matches = entries.filter(e => {
      const score = titleScore(plainTitle(input.title), e.title);
      const overlap = e.authors.map(norm).filter(name => local.includes(name)).length;
      return e.id && overlap && score >= 0.94 && norm(input.title).length >= 20;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function create(env) {
    let alive = true, automatic = true, running = false, cache = {}, write = Promise.resolve();
    let nextRequest = 0;
    const pending = new Map(), queue = [], backoff = new Map();
    const keyFor = input => JSON.stringify([input.id, input.title, input.doi, input.arxiv, input.authors,
      input.year, input.localSource, input.localDate]);
    const report = error => env.log(error);

    async function init() {
      const loaded = await env.read().catch(() => null);
      if (loaded?.records && typeof loaded.records === 'object') {
        // Older versions used fewer sources; retry their misses and failures now.
        cache = loaded.version === 4 ? loaded.records : Object.fromEntries(
          Object.entries(loaded.records).filter(([, r]) => r?.state === 'matched'));
      }
      automatic = env.getAuto();
    }
    function save() {
      const records = Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, 5000));
      cache = records;
      const payload = { version: 4, records };
      write = write.then(() => env.write(payload)).catch(report);
      return write;
    }
    async function request(url, xml = false) {
      const host = new URL(url).hostname;
      // VPNs and proxies often drop a single connection; retry once before giving up.
      for (let attempt = 1; ; attempt++) {
        let response;
        try {
          response = await send(url, xml, host);
          if (response.status === 0 || (response.status >= 500 && response.status !== 503)) {
            throw new Error('服务响应 HTTP ' + response.status);
          }
        } catch (error) {
          if (attempt >= 2 || !alive || /限流|已停止/.test(error.message)) {
            throw new Error(host + '：' + (error.message || String(error)));
          }
          continue;
        }
        try { return handle(response, host); }
        catch (error) { throw new Error(host + '：' + error.message); }
      }
    }
    async function send(url, xml, host) {
      if (!alive) throw new Error('查询已停止');
      if ((backoff.get(host) || 0) > env.now()) throw new Error('服务限流，稍后重试');
      await env.sleep(Math.max(0, nextRequest - env.now()));
      if (!alive) throw new Error('查询已停止');
      nextRequest = env.now() + 3100;
      return env.request(url, xml);
    }
    function handle(response, host) {
      if (response.status === 404) return null;
      if ([429, 503].includes(response.status)) {
        const raw = response.retryAfter;
        const delay = /^\d+$/.test(raw || '') ? Number(raw) * 1000 : Date.parse(raw) - env.now();
        backoff.set(host, env.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000));
      }
      if (response.status !== 200) throw new Error('服务响应 HTTP ' + response.status);
      return response.body;
    }
    async function byDOI(id, method) {
      if (!isFormalDOI(id)) return null;
      const data = await request('https://api.crossref.org/works/' + encodeURIComponent(id));
      if (!data) return null;
      if (!data.message || doi(data.message.DOI) !== id) throw new Error('Crossref DOI 响应不一致');
      return formalRecord(data.message, method);
    }
    async function lookup(input) {
      const errors = [];
      async function attempt(fn) {
        try { return await fn(); } catch (e) { errors.push(e.message || String(e)); return null; }
      }
      const direct = await attempt(() => byDOI(input.doi, '条目 DOI 精确匹配'));
      if (direct) return { state: 'matched', result: direct };
      let arxiv = null, arxivMethod = '';
      if (input.arxiv) {
        arxiv = await attempt(async () => parseArxiv(await request(
          'https://export.arxiv.org/api/query?id_list=' + encodeURIComponent(input.arxiv), true), input.arxiv));
        if (arxiv) arxivMethod = '条目 arXiv 编号';
        if (arxiv?.doi) {
          const published = await attempt(() => byDOI(arxiv.doi, 'arXiv 关联 DOI 精确匹配'));
          if (published) return { state: 'matched', result: published };
        }
      }
      const queryInput = { ...input, title: arxiv?.title || input.title,
        authors: input.authors.length ? input.authors : (arxiv?.authors || []) };
      let ambiguous = false;
      if (queryInput.title && queryInput.authors.length) {
        const params = new URLSearchParams({ 'query.title': queryInput.title,
          'query.author': queryInput.authors[0], rows: '8' });
        const choice = await attempt(async () => {
          const response = await request('https://api.crossref.org/works?' + params);
          if (!Array.isArray(response?.message?.items)) throw new Error('Crossref 搜索响应无效');
          return chooseWork(queryInput, response.message.items);
        });
        if (choice?.result) return { state: 'matched', result: choice.result };
        ambiguous = choice?.ambiguous || false;
      }
      // Many CS papers are arXiv-only and have no arXiv ID in Zotero; find the
      // preprint by title to recover its ID, upload date and any linked DOI.
      if (!arxiv && queryInput.title && queryInput.authors.length) {
        const params = new URLSearchParams({ search_query: arxivTitleQuery(queryInput.title), max_results: '5' });
        arxiv = await attempt(async () => chooseArxiv(queryInput,
          parseArxivEntries(await request('https://export.arxiv.org/api/query?' + params, true))));
        if (arxiv) arxivMethod = 'arXiv 标题与作者匹配';
        if (arxiv?.doi) {
          const published = await attempt(() => byDOI(arxiv.doi, 'arXiv 关联 DOI 精确匹配'));
          if (published) return { state: 'matched', result: published, arxivID: arxiv.id,
            arxivDate: arxiv.published, arxivMethod };
        }
      }
      const venue = arxiv && (venueFromNote(arxiv.journalRef, arxiv.published)
        || venueFromNote(arxiv.comment, arxiv.published));
      if (venue) {
        return { state: 'matched', arxivID: arxiv.id, arxivMethod, arxivDate: arxiv.published,
          journalRef: arxiv.journalRef || arxiv.comment,
          result: { source: venue.name, date: venue.year, kind: 'conference', doi: '',
            url: 'https://arxiv.org/abs/' + arxiv.id, provider: 'arXiv',
            method: 'arXiv 作者备注（' + (arxiv.journalRef ? 'journal_ref' : 'comment') + '），未经出版方核实',
            dateBasis: '会议年份（备注只给出年份）' } };
      }
      // Last resort: OpenReview hosts CoRL/ICLR/NeurIPS/CVPR decisions and DBLP imports.
      // Its search is often "unavailable"; retry twice, then skip without failing the lookup.
      let incomplete = false;
      if (queryInput.title && queryInput.authors.length) {
        const params = new URLSearchParams({ term: openReviewTerm(queryInput.title),
          limit: '8', source: 'forum' });
        let found = null;
        for (let tries = 0; tries < 3 && !found; tries++) {
          const response = await request('https://api2.openreview.net/notes/search?' + params)
            .catch(e => ({ failed: e.message || String(e) }));
          if (response?.failed || response?.searchUnavailable || !Array.isArray(response?.notes)) {
            incomplete = true; continue;
          }
          incomplete = false;
          found = chooseOpenReview(queryInput, response.notes) || 'none';
        }
        if (found && found !== 'none') {
          return { state: 'matched', arxivID: arxiv?.id || '', arxivMethod,
            arxivDate: arxiv?.published || '', journalRef: arxiv?.journalRef || arxiv?.comment || '',
            result: { source: found.source, date: found.year, kind: 'conference', doi: '',
              url: found.id ? 'https://openreview.net/forum?id=' + encodeURIComponent(found.id) : '',
              provider: 'OpenReview', method: 'OpenReview 标题与作者匹配',
              dateBasis: '会议/期刊年份（OpenReview 只给出年份）' } };
        }
      }
      return { state: errors.length ? 'error' : ambiguous ? 'ambiguous' : 'unmatched', incomplete,
        error: errors.join('；'), journalRef: arxiv?.journalRef || arxiv?.comment || '',
        arxivID: arxiv?.id || '', arxivMethod,
        arxivDate: /^\d{4}-(0[1-9]|1[0-2])$/.test(arxiv?.published || '') ? arxiv.published : '',
        note: !queryInput.authors.length && !isFormalDOI(input.doi) ? '缺少作者，未使用仅标题结果自动匹配' : '' };
    }
    function snapshot(input) {
      const key = keyFor(input);
      return { ...(cache[key] || {}), pending: pending.has(key) };
    }
    function enqueue(input, force = false) {
      if (!alive || (!automatic && !force)) return Promise.resolve(snapshot(input));
      const key = keyFor(input);
      if (pending.has(key)) {
        const existing = pending.get(key);
        if (force) {
          existing.force = true;
          const index = queue.indexOf(existing);
          if (index > 0) queue.unshift(queue.splice(index, 1)[0]);
        }
        return existing.promise;
      }
      const old = cache[key];
      const ttl = old?.state === 'error' ? 600000 : old?.state === 'matched' ? 7 * DAY
        : old?.incomplete ? 3600000 : DAY;
      if (!force && old && env.now() - old.checkedAt < ttl) return Promise.resolve(old);
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      const job = { input, key, resolve, promise, force };
      pending.set(key, job);
      if (force) queue.unshift(job); else queue.push(job);
      void pump();
      return promise;
    }
    async function pump() {
      if (running) return;
      running = true;
      try {
        while (alive && queue.length) {
          const job = queue.shift();
          let record;
          try { record = await lookup(job.input); }
          catch (error) { record = { state: 'error', error: error.message || String(error) }; }
          if (alive) {
            // A temporary outage should not erase a previously verified result.
            const previous = cache[job.key];
            if (record.state === 'error' && previous?.result) record.result = previous.result;
            if (record.state === 'error' && previous?.arxivDate && !record.arxivDate) {
              Object.assign(record, { arxivDate: previous.arxivDate, arxivID: previous.arxivID,
                arxivMethod: previous.arxivMethod, journalRef: previous.journalRef });
            }
            record.checkedAt = env.now(); cache[job.key] = record;
            await save();
          }
          pending.delete(job.key);
          job.resolve(record);
          if (alive) await env.changed(job.input.id).catch(report);
        }
      } finally { running = false; }
    }
    function setAuto(value) {
      automatic = value; env.setAuto(value);
      if (!value) {
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i].force) continue;
          const [job] = queue.splice(i, 1); pending.delete(job.key); job.resolve(snapshot(job.input));
        }
      }
    }
    async function stop() {
      alive = false;
      for (const job of queue.splice(0)) { pending.delete(job.key); job.resolve({ state: 'stopped' }); }
      await write;
    }
    return { init, enqueue, snapshot, stop, setAuto, getAuto: () => automatic, keyFor };
  }
  return { create, norm, doi, arxivID, yearMonth, chooseWork, formalRecord, parseArxiv, parseArxivEntries,
    arxivTitleQuery, chooseArxiv, plainTitle, venueFromNote, openReviewVenue, chooseOpenReview, openReviewTerm };
})();
