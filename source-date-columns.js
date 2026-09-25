/*
 * Source Date Columns
 * Columns use local metadata immediately and enrich it using online.js.
 */

var SourceDateColumns = (() => {
	const registeredDataKeys = [];
	const menus = [];
	let online;
	let batchRunning = false;
	let active = false;

	const MONTHS = {
		jan: 1,
		january: 1,
		feb: 2,
		february: 2,
		mar: 3,
		march: 3,
		apr: 4,
		april: 4,
		may: 5,
		jun: 6,
		june: 6,
		jul: 7,
		july: 7,
		aug: 8,
		august: 8,
		sep: 9,
		sept: 9,
		september: 9,
		oct: 10,
		october: 10,
		nov: 11,
		november: 11,
		dec: 12,
		december: 12,
	};

	function clean(value) {
		if (value === undefined || value === null || value === false) {
			return "";
		}
		return String(value).replace(/\s+/g, " ").trim();
	}

	function getField(item, field) {
		try {
			return clean(item.getField(field));
		}
		catch (error) {
			return "";
		}
	}

	function firstNonEmpty(values) {
		for (const value of values) {
			const normalized = clean(value);
			if (normalized) {
				return normalized;
			}
		}
		return "";
	}

	function isRegularItem(item) {
		if (!item) {
			return false;
		}
		if (typeof item.isRegularItem === "function") {
			return item.isRegularItem();
		}
		return true;
	}

	function arXivMetadata(item) {
		return [
			getField(item, "repository"),
			getField(item, "archive"),
			getField(item, "archiveID"),
			getField(item, "libraryCatalog"),
			getField(item, "DOI"),
			getField(item, "url"),
			getField(item, "extra"),
		].filter(Boolean).join("\n");
	}

	function isArXivText(value) {
		return /(?:\barxiv\b|arxiv\.org|10\.48550\/arxiv)/i.test(clean(value));
	}

	function isArXivItem(item) {
		return isArXivText(arXivMetadata(item));
	}

	function sourceForItem(item) {
		if (!isRegularItem(item)) {
			return "";
		}

		// Conference metadata is the most specific source and takes priority.
		const conference = firstNonEmpty([
			getField(item, "conferenceName"),
			getField(item, "proceedingsTitle"),
		]);
		if (conference) {
			return conference;
		}

		// Journals, magazines and newspapers all use publicationTitle.
		const publication = firstNonEmpty([
			getField(item, "publicationTitle"),
			getField(item, "journalAbbreviation"),
		]);
		if (publication && !isArXivText(publication)) {
			return publication;
		}

		// Treat an arXiv record as arXiv only when no published venue was found.
		if (isArXivItem(item) || isArXivText(publication)) {
			return "arXiv";
		}

		// Other preprint servers (e.g. bioRxiv/SSRN) remain useful fallbacks.
		if (item.itemType === "preprint") {
			return firstNonEmpty([
				getField(item, "repository"),
				getField(item, "archive"),
			]);
		}

		return "";
	}

	function twoDigits(number) {
		return number < 10 ? "0" + number : String(number);
	}

	function formatYearMonth(year, month) {
		const numericYear = Number(year);
		const numericMonth = Number(month);
		if (!Number.isInteger(numericYear) || numericYear < 1000 || numericYear > 2999) {
			return "";
		}
		if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
			return String(numericYear);
		}
		return numericYear + "-" + twoDigits(numericMonth);
	}

	function parseStoredDate(value) {
		const text = clean(value);
		if (!text) {
			return "";
		}

		let match = text.match(/\b((?:1[6-9]|20|21)\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月/);
		if (match) {
			return formatYearMonth(match[1], match[2]);
		}

		match = text.match(/\b((?:1[6-9]|20|21)\d{2})[-\/.](1[0-2]|0?[1-9])(?:[-\/.]\d{1,2})?/);
		if (match) {
			return formatYearMonth(match[1], match[2]);
		}

		match = text.match(/\b((?:1[6-9]|20|21)\d{2})(0[1-9]|1[0-2])(?:[0-3]\d)?\b/);
		if (match) {
			return formatYearMonth(match[1], match[2]);
		}

		const yearMatch = text.match(/\b((?:1[6-9]|20|21)\d{2})\b/);
		const monthMatch = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i);
		if (yearMatch && monthMatch) {
			return formatYearMonth(yearMatch[1], MONTHS[monthMatch[1].toLowerCase()]);
		}

		return yearMatch ? yearMatch[1] : "";
	}

	function dateFromArXivIdentifier(value) {
		const text = clean(value);
		if (!text) {
			return "";
		}

		// New identifiers: arXiv:2503.12345 (YYMM.number).
		let match = text.match(/(?:arxiv\s*[:./]?\s*)?(\d{2})(0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?\b/i);
		if (!match) {
			// Old identifiers: hep-th/9901001 (subject/YYMMnumber).
			match = text.match(/(?:^|[\s:/])(?:[a-z-]+(?:\.[A-Z]{2})?\/)?(\d{2})(0[1-9]|1[0-2])\d{3}(?:v\d+)?\b/i);
		}
		if (!match) {
			return "";
		}

		const shortYear = Number(match[1]);
		const fullYear = shortYear >= 91 ? 1900 + shortYear : 2000 + shortYear;
		return formatYearMonth(fullYear, match[2]);
	}

	function dateForItem(item) {
		if (!isRegularItem(item)) {
			return "";
		}

		const storedDate = firstNonEmpty([
			getField(item, "date"),
			getField(item, "dateDecided"),
			getField(item, "issueDate"),
		]);
		const parsedDate = parseStoredDate(storedDate);
		if (parsedDate) {
			return parsedDate;
		}

		// For arXiv-only items, the identifier itself reliably contains YYMM.
		// Do not substitute an upload date for a formally published item whose
		// publication date is missing.
		if (sourceForItem(item) === "arXiv") {
			return dateFromArXivIdentifier(arXivMetadata(item));
		}

		return "";
	}

	function inputFor(item) {
		let authors = [];
		try { authors = item.getCreators().filter(c => !c.fieldMode && c.lastName
			&& c.creatorTypeID === Zotero.CreatorTypes.getID('author')).map(c => c.lastName); }
		catch (_) {}
		const meta = arXivMetadata(item);
		const arxiv = isArXivItem(item) || sourceForItem(item) === 'arXiv'
			? SourceDateOnline.arxivID(getField(item, 'archiveID')) || SourceDateOnline.arxivID(meta) : '';
		const extraDOI = getField(item, 'extra').match(/(?:^|\s)DOI:\s*(10\.\d{4,9}\/\S+)/i)?.[1];
		return { id: item.id, title: getField(item, 'title'), authors, arxiv,
			doi: SourceDateOnline.doi(getField(item, 'DOI') || extraDOI),
			year: Number(dateForItem(item).slice(0, 4)) || 0,
			localSource: sourceForItem(item), localDate: dateForItem(item) };
	}

	function display(item, schedule = true) {
		if (!isRegularItem(item)) return { source: '', date: '' };
		const input = inputFor(item);
		if (schedule && online && item.id) void online.enqueue(input);
		const record = online?.snapshot(input) || {};
		if (record.result) return { ...record.result, record };
		// Only an arXiv record was found: show it when Zotero has no other venue.
		const arxivOnly = record.arxivDate && (!input.localSource || input.localSource === 'arXiv');
		return { source: arxivOnly ? 'arXiv' : input.localSource,
			date: arxivOnly ? record.arxivDate : input.localDate, record };
	}

	function describe(item) {
		const value = display(item, false), r = value.record || {};
		const state = { matched: '已匹配正式发表记录', unmatched: '未找到可靠正式发表记录',
			ambiguous: '多个候选，未自动采用', error: '查询未完成（网络或服务错误）' }[r.state] || '尚未联网查询';
		return [getField(item, 'title'), '出处：' + (value.source || '未知'), '日期：' + (value.date || '未知'),
			r.pending ? '状态：查询中…' : '状态：' + state,
			r.result ? '匹配方式：' + r.result.method : '当前显示：Zotero 本地元数据 / arXiv 上传日期',
			r.arxivID ? 'arXiv：' + r.arxivID + (r.arxivMethod ? '（' + r.arxivMethod + '）' : '')
				+ (r.arxivDate ? '，首版 ' + r.arxivDate : '') : '',
			r.result?.dateBasis, r.result?.url,
			r.checkedAt ? '查询时间：' + new Date(r.checkedAt).toLocaleString() : '',
			r.error, r.state === 'error' ? '提示：若使用 VPN/代理，请确认 Zotero 能访问 api.crossref.org 与 export.arxiv.org；失败结果 10 分钟后自动重试。' : '',
			r.incomplete ? 'OpenReview 搜索暂不可用，1 小时后自动重试。' : '',
			r.note, r.journalRef ? 'arXiv 原始发表备注（未自动解析）：' + r.journalRef : '',
			'未找到记录不等于尚未发表。'].filter(Boolean).join('\n');
	}

	function environment() {
		const path = PathUtils.join(Zotero.Profile.dir, 'source-date-columns-cache.json');
		return {
			now: () => Date.now(), sleep: ms => Zotero.Promise.delay(ms),
			getAuto: () => Zotero.Prefs.get('sourceDateColumns.auto') !== false,
			setAuto: value => Zotero.Prefs.set('sourceDateColumns.auto', value),
			read: () => IOUtils.readJSON(path),
			write: data => IOUtils.writeJSON(path, data, { tmpPath: path + '.tmp' }),
			log: e => Zotero.logError(e),
			changed: id => Zotero.Notifier.trigger('refresh', 'item', [id]),
			request: async (url, xml) => {
				const xhr = await Zotero.HTTP.request('GET', url, {
					responseType: 'text', successCodes: false, timeout: 30000,
					errorDelayMax: 0, anon: true,
					headers: { Accept: xml ? 'application/atom+xml' : 'application/json' }
				});
				return { status: xhr.status, retryAfter: xhr.getResponseHeader('Retry-After'),
					body: xhr.status !== 200 ? null : xml ? new DOMParser().parseFromString(xhr.responseText, 'application/xml')
						: JSON.parse(xhr.responseText) };
			}
		};
	}

	// Read status is an ordinary Zotero tag on the top-level item, so it syncs,
	// shows in the tag selector and can be removed by hand.
	const READ_TAG = '已读';
	const READ_CLASS = 'source-date-read';
	const STYLE_ID = 'source-date-columns-read-style';
	// Tint the whole row light blue when any of this plugin's cells in it is marked read.
	// Selected and highlighted rows keep Zotero's own colors.
	// A dark background needs a stronger tint for the same visual difference.
	const READ_ROW = `#zotero-items-tree .virtualized-table .row:has(.${READ_CLASS}):not(.selected):not(.highlighted)`;
	const READ_CSS = `${READ_ROW} {
	background-color: color-mix(in srgb, var(--accent-blue, #4072e5) 16%, var(--material-background));
}
@media (prefers-color-scheme: dark) {
	${READ_ROW} {
		background-color: color-mix(in srgb, var(--accent-blue, #4072e5) 35%, var(--material-background));
	}
}`;

	function readTarget(item) {
		if (!item || typeof item !== 'object' || item.isFeedItem) return null;
		return item.topLevelItem || item;
	}

	function isRead(item) {
		try { return !!readTarget(item)?.hasTag(READ_TAG); }
		catch (_) { return false; }
	}

	function readTargets(items) {
		const targets = new Map();
		for (const item of items || []) {
			const target = readTarget(item);
			if (target && target.isEditable?.() !== false) targets.set(target.id, target);
		}
		return [...targets.values()];
	}

	async function setRead(items, read) {
		const targets = readTargets(items);
		await Zotero.DB.executeTransaction(async () => {
			for (const target of targets) {
				if (read ? target.addTag(READ_TAG) : target.removeTag(READ_TAG)) await target.save();
			}
		});
	}

	// Zotero wraps plugin callbacks in `(...args) => fn(...args)`, so `this` is not the
	// item tree here. The columns only exist in the main tree, which is ZoteroPane.itemsView.
	function renderReadAwareCell(index, data, column, isFirstColumn, doc) {
		const cell = doc.createElement('span');
		cell.className = `cell ${column.className}`;
		cell.textContent = data;
		let item = null;
		try { item = doc.defaultView?.ZoteroPane?.itemsView?.getRow(index)?.ref || null; } catch (_) {}
		// Only the paper's own row is shaded; child attachment/note rows keep Zotero's colors.
		cell.classList.toggle(READ_CLASS, !!item && !item.parentID && isRead(item));
		return cell;
	}

	function addStyles(win) {
		const doc = win?.document;
		if (!doc?.documentElement || doc.getElementById(STYLE_ID)) return;
		const style = doc.createElementNS('http://www.w3.org/1999/xhtml', 'style');
		style.id = STYLE_ID;
		style.textContent = READ_CSS;
		doc.documentElement.appendChild(style);
	}

	function removeStyles(win) {
		win?.document?.getElementById(STYLE_ID)?.remove();
	}

	// Reader toolbar toggle. Zotero's renderToolbar hook only offers a slot at the
	// right end of the toolbar, so the button is moved next to the annotation tools
	// (after the color picker) when that group exists.
	const READER_BUTTON_ID = 'source-date-read-toolbar';
	const SVG = 'http://www.w3.org/2000/svg';
	const readerButtons = new Set();
	let notifierID = null;

	function readerItem(reader) {
		try { return Zotero.Items.get(reader?.itemID) || null; }
		catch (_) { return null; }
	}

	function updateReaderButton(button, item) {
		const read = isRead(item);
		button.classList.toggle('active', read);
		button.setAttribute('aria-pressed', String(read));
		button.setAttribute('title', read ? '已读（点击标记为未读）' : '标记为已读');
		const icon = button.querySelector('svg');
		icon?.querySelector('circle')?.setAttribute('fill', read ? 'var(--accent-blue, #4072e5)' : 'none');
		icon?.querySelector('circle')?.setAttribute('stroke', read ? 'var(--accent-blue, #4072e5)' : 'currentColor');
		icon?.querySelector('path')?.setAttribute('stroke', read ? '#fff' : 'currentColor');
	}

	function updateReaderButtons() {
		for (const entry of [...readerButtons]) {
			const button = entry.button.deref();
			if (!button?.isConnected) { readerButtons.delete(entry); continue; }
			updateReaderButton(button, readerItem(entry.reader));
		}
	}

	function injectReaderButton(reader, doc, append) {
		const item = readerItem(reader);
		if (!doc || !readTarget(item)) return;
		// The toolbar may render again (e.g. after a view change); keep a single button.
		doc.getElementById(READER_BUTTON_ID)?.remove();
		const wrap = doc.createElement('div');
		wrap.id = READER_BUTTON_ID;
		wrap.style.display = 'flex';
		wrap.style.alignItems = 'center';
		const divider = doc.createElement('div');
		divider.className = 'divider';
		const button = doc.createElement('button');
		button.className = 'toolbar-button source-date-read-button';
		button.tabIndex = -1;
		button.style.width = 'auto';
		button.style.padding = '0 6px';
		button.style.gap = '4px';
		const icon = doc.createElementNS(SVG, 'svg');
		icon.setAttribute('width', '16');
		icon.setAttribute('height', '16');
		icon.setAttribute('viewBox', '0 0 20 20');
		const circle = doc.createElementNS(SVG, 'circle');
		for (const [k, v] of [['cx', '10'], ['cy', '10'], ['r', '8'], ['stroke-width', '1.5']]) circle.setAttribute(k, v);
		const check = doc.createElementNS(SVG, 'path');
		for (const [k, v] of [['d', 'M6.5 10.3l2.3 2.3 4.7-5'], ['fill', 'none'], ['stroke-width', '1.6'],
			['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) check.setAttribute(k, v);
		icon.append(circle, check);
		const label = doc.createElement('span');
		label.textContent = '已读';
		button.append(icon, label);
		button.addEventListener('click', () => {
			const current = readerItem(reader);
			void setRead([current], !isRead(current)).catch(e => Zotero.logError(e));
		});
		updateReaderButton(button, item);
		wrap.append(divider, button);
		const tools = doc.querySelector('.toolbar .center.tools');
		if (tools) tools.append(wrap);
		else append?.(wrap);
		readerButtons.add({ button: new WeakRef(button), reader });
	}

	function onRenderToolbar({ reader, doc, append }) {
		try { injectReaderButton(reader, doc, append); }
		catch (e) { Zotero.logError(e); }
	}

	function registerReader(pluginID) {
		if (!Zotero.Reader?.registerEventListener) return;
		// Listeners registered with a plugin ID are removed by Zotero when the plugin shuts down.
		Zotero.Reader.registerEventListener('renderToolbar', onRenderToolbar, pluginID);
		notifierID = Zotero.Notifier.registerObserver({ notify: () => updateReaderButtons() },
			['item', 'item-tag'], 'source-date-read');
		// Readers opened before the plugin started have already rendered their toolbar.
		for (const reader of Zotero.Reader._readers || []) {
			try {
				const doc = reader._iframeWindow?.document;
				if (doc?.querySelector('.toolbar')) injectReaderButton(reader, doc);
			}
			catch (e) { Zotero.logError(e); }
		}
	}

	function unregisterReader() {
		if (notifierID) Zotero.Notifier.unregisterObserver(notifierID);
		notifierID = null;
		for (const entry of readerButtons) entry.button.deref()?.parentNode?.remove();
		readerButtons.clear();
	}

	function selected(context) {
		const win = context?.menuElem?.ownerGlobal || Zotero.getMainWindow();
		return (win?.ZoteroPane?.getSelectedItems() || []).filter(isRegularItem);
	}

	async function refreshSelected(context) {
		if (batchRunning) return;
		const items = selected(context);
		if (!items.length) return;
		batchRunning = true;
		const progress = new Zotero.ProgressWindow();
		progress.changeHeadline('联网查询出处与日期');
		progress.show();
		const line = new progress.ItemProgress('journalArticle', `0 / ${items.length}`);
		try {
			let matched = 0, failed = 0;
			for (let i = 0; i < items.length && active; i++) {
				const r = await online.enqueue(inputFor(items[i]), true);
				if (r.state === 'matched') matched++;
				if (r.state === 'error') failed++;
				line.setText(`${i + 1} / ${items.length}；匹配 ${matched}；失败 ${failed}`);
				line.setProgress((i + 1) / items.length * 100);
			}
			progress.changeHeadline(active ? '查询完成（右键可查看详情）' : '查询停止');
		} catch (e) { Zotero.logError(e); progress.changeHeadline('查询失败，请查看错误控制台'); }
		finally { batchRunning = false; progress.startCloseTimer(8000); }
	}

	function registerMenus(pluginID) {
		const refresh = { menuType: 'menuitem',
			onShowing: (_, c) => { c.menuElem.setAttribute('label', '联网刷新出处与日期（所选条目）'); c.setEnabled(!batchRunning && selected(c).length > 0); },
			onCommand: (_, c) => { void refreshSelected(c); } };
		const details = { menuType: 'menuitem',
			onShowing: (_, c) => { c.menuElem.setAttribute('label', '查看出处查询详情'); c.setEnabled(selected(c).length === 1); },
			onCommand: (_, c) => { const item = selected(c)[0]; if (item) Services.prompt.alert(c.menuElem.ownerGlobal, '出处与日期 · 查询详情', describe(item)); } };
		const toggle = { menuType: 'menuitem',
			onShowing: (_, c) => { c.menuElem.setAttribute('label', online.getAuto() ? '关闭自动联网查询出处' : '开启自动联网查询出处'); },
			onCommand: () => { online.setAuto(!online.getAuto()); Zotero.ItemTreeManager.refreshColumns(); } };
		// The item context menu passes the selected items; the tab menu and the Tools menu
		// in a reader tab pass the open attachment, which readTarget maps to its paper.
		const markRead = { menuType: 'menuitem',
			onShowing: (_, c) => {
				const targets = readTargets(c.items);
				c.menuElem.setAttribute('label', targets.length && targets.every(isRead) ? '标记为未读' : '标记为已读');
				c.setVisible(targets.length > 0);
			},
			onCommand: (_, c) => {
				const targets = readTargets(c.items);
				void setRead(targets, !(targets.length && targets.every(isRead))).catch(e => Zotero.logError(e));
			} };
		const menusFor = {
			'main/library/item': [refresh, details, markRead],
			'main/menubar/tools': [refresh, details, markRead, toggle],
			'main/tab': [markRead],
		};
		for (const [target, items] of Object.entries(menusFor)) {
			const id = Zotero.MenuManager.registerMenu({ menuID: 'source-date-' + target.replaceAll('/', '-'), pluginID, target,
				menus: items });
			if (!id) throw new Error('出处与日期菜单注册失败');
			menus.push(id);
		}
	}

	async function startup(pluginID, env) {
		online = SourceDateOnline.create(env || environment());
		await online.init();
		active = true;
		const commonOptions = {
			pluginID,
			enabledTreeIDs: ['main'],
			showInColumnPicker: true,
			zoteroPersist: ["width", "hidden", "sortDirection"],
		};

		registeredDataKeys.push(await Zotero.ItemTreeManager.registerColumn({
			...commonOptions,
			dataKey: "sourceDateColumnsPublicationSource",
			label: "出处",
			flex: 2,
			dataProvider: item => display(item).source,
			renderCell: renderReadAwareCell,
		}));

		registeredDataKeys.push(await Zotero.ItemTreeManager.registerColumn({
			...commonOptions,
			dataKey: "sourceDateColumnsPublicationYearMonth",
			label: "日期",
			width: "92",
			staticWidth: true,
			sortReverse: true,
			dataProvider: item => display(item).date,
			renderCell: renderReadAwareCell,
		}));

		registeredDataKeys.push(await Zotero.ItemTreeManager.registerColumn({
			...commonOptions,
			dataKey: "sourceDateColumnsRead",
			label: "已读",
			width: "44",
			staticWidth: true,
			dataProvider: item => item && !item.parentID && isRead(item) ? '✓' : '',
			renderCell: renderReadAwareCell,
		}));
		if (registeredDataKeys.some(key => !key)) throw new Error('出处与日期列注册失败');
		registerMenus(pluginID);
		registerReader(pluginID);
		for (const win of Zotero.getMainWindows?.() || []) addStyles(win);
	}

	async function shutdown() {
		active = false;
		for (const win of Zotero.getMainWindows?.() || []) removeStyles(win);
		unregisterReader();
		await online?.stop();
		for (const id of menus.splice(0)) Zotero.MenuManager.unregisterMenu(id);
		while (registeredDataKeys.length) {
			const dataKey = registeredDataKeys.pop();
			try {
				await Zotero.ItemTreeManager.unregisterColumn(dataKey);
			}
			catch (error) {
				Zotero.logError(error);
			}
		}
	}

	return {
		startup,
		shutdown,
		describe,
		onMainWindowLoad: win => { if (active) addStyles(win); },
		onMainWindowUnload: removeStyles,
		_test: {
			dateForItem,
			dateFromArXivIdentifier,
			parseStoredDate,
			sourceForItem,
			inputFor,
			display,
			isRead,
			readTargets,
			setRead,
			renderReadAwareCell,
			onRenderToolbar,
		},
	};
})();
