"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "..", "source-date-columns.js");
const sandbox = { URL, URLSearchParams };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'online.js'), 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), sandbox, {
	filename: sourcePath,
});

const addon = sandbox.SourceDateColumns;
const {
	dateForItem,
	dateFromArXivIdentifier,
	parseStoredDate,
	sourceForItem,
} = addon._test;

function item(fields, itemType = "journalArticle", regular = true) {
	return {
		itemType,
		getField(field) {
			return fields[field] || "";
		},
		isRegularItem() {
			return regular;
		},
	};
}

assert.equal(
	sourceForItem(item({ conferenceName: "Robotics: Science and Systems" }, "conferencePaper")),
	"Robotics: Science and Systems",
);
assert.equal(
	sourceForItem(item({ proceedingsTitle: "Proceedings of ICRA 2026" }, "conferencePaper")),
	"Proceedings of ICRA 2026",
);
assert.equal(
	sourceForItem(item({ publicationTitle: "Science Robotics" })),
	"Science Robotics",
);
assert.equal(
	sourceForItem(item({
		publicationTitle: "Science Robotics",
		archive: "arXiv",
		archiveID: "2503.12345",
	})),
	"Science Robotics",
);
assert.equal(
	sourceForItem(item({ repository: "arXiv", archiveID: "2503.12345" }, "preprint")),
	"arXiv",
);
assert.equal(
	sourceForItem(item({ repository: "bioRxiv" }, "preprint")),
	"bioRxiv",
);
assert.equal(sourceForItem(item({}, "attachment", false)), "");

assert.equal(parseStoredDate("2026-09-23"), "2026-09");
assert.equal(parseStoredDate("September 23, 2026"), "2026-09");
assert.equal(parseStoredDate("2026年9月23日"), "2026-09");
assert.equal(parseStoredDate("20260923"), "2026-09");
assert.equal(parseStoredDate("Spring 2026"), "2026");
assert.equal(parseStoredDate("2026"), "2026");

assert.equal(dateFromArXivIdentifier("arXiv:2503.12345v2"), "2025-03");
assert.equal(dateFromArXivIdentifier("https://arxiv.org/abs/hep-th/9901001"), "1999-01");
assert.equal(
	dateForItem(item({ repository: "arXiv", archiveID: "2503.12345" }, "preprint")),
	"2025-03",
);
assert.equal(
	dateForItem(item({
		publicationTitle: "Science Robotics",
		archive: "arXiv",
		archiveID: "2503.12345",
	})),
	"",
);
assert.equal(
	dateForItem(item({ publicationTitle: "Science Robotics", date: "2025-07-14" })),
	"2025-07",
);

// Just enough DOM for the reader toolbar button.
function fakeDocument() {
	const all = [];
	const make = (tag, className = '') => {
		const classes = new Set(className.split(' ').filter(Boolean));
		const el = { tag, id: '', children: [], attrs: {}, style: {}, parentNode: null, listeners: {}, text: '',
			classList: { toggle: (c, on) => (on ?? !classes.has(c)) ? classes.add(c) : classes.delete(c), has: c => classes.has(c) },
			get className() { return [...classes].join(' '); },
			set className(v) { classes.clear(); v.split(' ').filter(Boolean).forEach(c => classes.add(c)); },
			get textContent() { return el.text + el.children.map(c => c.textContent).join(''); },
			set textContent(v) { el.text = v; },
			get isConnected() { let n = el; while (n.parentNode) n = n.parentNode; return n === root; },
			setAttribute: (k, v) => { el.attrs[k] = v; },
			append: (...nodes) => nodes.forEach(n => { n.parentNode?.children.splice(n.parentNode.children.indexOf(n), 1);
				n.parentNode = el; el.children.push(n); }),
			remove: () => { if (el.parentNode) { el.parentNode.children.splice(el.parentNode.children.indexOf(el), 1); el.parentNode = null; } },
			addEventListener: (type, fn) => { el.listeners[type] = fn; },
			click: () => el.listeners.click?.(),
			querySelector: sel => find(el, sel.replace(/^\.toolbar /, '')),
		};
		all.push(el);
		return el;
	};
	const matches = (el, sel) => sel.startsWith('.') ? sel.slice(1).split('.').every(c => el.classList.has(c)) : el.tag === sel;
	const find = (el, sel) => { for (const c of el.children) { if (matches(c, sel)) return c; const f = find(c, sel); if (f) return f; } return null; };
	const root = make('div', 'toolbar');
	return { make, add: (tag, cls) => { const el = make(tag, cls); root.append(el); return el; },
		createElement: tag => make(tag), createElementNS: (_, tag) => make(tag),
		getElementById: id => all.find(el => el.id === id && el.isConnected) || null,
		querySelector: sel => sel === '.toolbar' ? root : find(root, sel.replace(/^\.toolbar /, '')) };
}

async function testColumnLifecycle() {
	const registered = [];
	const unregistered = [];
	const menus = [];
	// Minimal main-window document: enough for adding/removing the row stylesheet.
	const nodes = new Map();
	const doc = {
		documentElement: { appendChild: node => { nodes.set(node.id, node); } },
		getElementById: id => nodes.get(id) || null,
		createElementNS: () => { const node = { remove: () => nodes.delete(node.id) }; return node; },
	};
	const readerListeners = [], observers = new Map();
	const itemsByID = new Map();
	sandbox.Zotero = {
		Reader: { registerEventListener: (type, handler, id) => readerListeners.push({ type, handler, id }), _readers: [] },
		Notifier: { registerObserver: o => { observers.set('obs', o); return 'obs'; },
			unregisterObserver: id => observers.delete(id) },
		Items: { get: id => itemsByID.get(id) || false },
		MenuManager: { registerMenu: o => { menus.push(o); return o.menuID; }, unregisterMenu: () => {} },
		getMainWindows: () => [{ document: doc }],
		DB: { executeTransaction: async fn => fn() },
		ItemTreeManager: {
			async registerColumn(options) {
				// Like Zotero's PluginAPIBase: callbacks are wrapped, so they never see `this`.
				const wrapped = { ...options };
				for (const [key, fn] of Object.entries(options)) {
					if (typeof fn === 'function') wrapped[key] = (...args) => fn(...args);
				}
				registered.push(wrapped);
				return options.dataKey;
			},
			async unregisterColumn(dataKey) {
				unregistered.push(dataKey);
			},
		},
		logError(error) {
			throw error;
		},
	};

	await addon.startup("source-date-columns@local.zotero", {
		read: async () => null, getAuto: () => false,
	});
	assert.equal(registered.length, 3);
	assert.equal(registered[0].label, "出处");
	assert.equal(registered[1].label, "日期");
	assert.equal(registered[2].label, "已读");
	assert.deepEqual(menus.map(m => m.target), ['main/library/item', 'main/menubar/tools', 'main/tab']);
	const readCSS = nodes.get('source-date-columns-read-style').textContent;
	assert.match(readCSS, /\.row:has\(\.source-date-read\):not\(\.selected\)/);
	assert.match(readCSS, /#4072e5\) 16%/, 'light theme tint');
	assert.match(readCSS, /prefers-color-scheme: dark\)[\s\S]*#4072e5\) 35%/, 'stronger dark theme tint');
	assert.equal(registered[0].pluginID, "source-date-columns@local.zotero");
	assert.equal(registered[0].dataProvider(item({ publicationTitle: "Nature" })), "Nature");
	assert.equal(registered[1].dataProvider(item({ date: "2026-09-23" })), "2026-09");

	// Read status: tag on the top-level item; the reader tab passes the child PDF.
	const tagged = (id, parent = null) => {
		const tags = new Set();
		const self = { id, parentID: parent?.id || false, topLevelItem: null, saves: 0, isEditable: () => true,
			getField: () => '', isRegularItem: () => !parent,
			hasTag: t => tags.has(t), addTag: t => !tags.has(t) && !!tags.add(t),
			removeTag: t => tags.delete(t), save: async () => { self.saves++; } };
		self.topLevelItem = parent || self;
		return self;
	};
	const readPaper = tagged(1), pdf = tagged(2, readPaper), other = tagged(3);
	const { isRead, readTargets, setRead } = addon._test;
	assert.deepEqual(Array.from(readTargets([pdf, readPaper, false, { isFeedItem: true }]), i => i.id), [1]);
	await setRead([pdf], true);
	assert.equal(isRead(readPaper), true); assert.equal(isRead(other), false); assert.equal(readPaper.saves, 1);
	await setRead([readPaper], true); assert.equal(readPaper.saves, 1, 'no save when already read');
	const markRead = menus.find(m => m.target === 'main/tab').menus[0];
	const menuContext = items => { const state = {}; return { state, items,
		menuElem: { setAttribute: (k, v) => { state[k] = v; } }, setVisible: v => { state.visible = v; } }; };
	let shown = menuContext([pdf]); markRead.onShowing(null, shown);
	assert.equal(shown.state.label, '标记为未读'); assert.equal(shown.state.visible, true);
	shown = menuContext([readPaper, other]); markRead.onShowing(null, shown);
	assert.equal(shown.state.label, '标记为已读', 'mixed selection marks all as read');
	shown = menuContext([false]); markRead.onShowing(null, shown);
	assert.equal(shown.state.visible, false, 'library tab has no readPaper');
	assert.equal(registered[2].dataProvider(readPaper), '✓');
	assert.equal(registered[2].dataProvider(pdf), '');
	const cellDoc = rows => ({ defaultView: { ZoteroPane: { itemsView: { getRow: index => ({ ref: rows[index] }) } } },
		createElement: () => { const classes = new Set();
			return { classList: { toggle: (c, on) => on ? classes.add(c) : classes.delete(c), has: c => classes.has(c) } }; } });
	// Called through the registered (wrapped) column, exactly as the item tree does.
	const cell = (rows, index) => registered[0].renderCell.call({}, index, 'x', { className: 'c' }, false, cellDoc(rows));
	assert.equal(cell([readPaper, pdf, other], 0).classList.has('source-date-read'), true);
	assert.equal(cell([readPaper, pdf, other], 1).classList.has('source-date-read'), false, 'child rows are not shaded');
	assert.equal(cell([readPaper, pdf, other], 2).classList.has('source-date-read'), false);
	assert.equal(cell([readPaper], 0).textContent, 'x');
	await setRead([pdf], false); assert.equal(isRead(readPaper), false);

	// Reader toolbar: the button goes after the color picker in the annotation tools.
	assert.equal(readerListeners.length, 1);
	assert.equal(readerListeners[0].type, 'renderToolbar');
	assert.equal(readerListeners[0].id, 'source-date-columns@local.zotero');
	itemsByID.set(pdf.id, pdf);
	const readerDoc = fakeDocument();
	const tools = readerDoc.add('div', 'center tools');
	tools.append(readerDoc.make('button', 'toolbar-button highlight'), readerDoc.make('button', 'toolbar-button toolbar-dropdown-button'));
	const appended = [];
	const renderToolbar = () => readerListeners[0].handler({ reader: { itemID: pdf.id }, doc: readerDoc,
		append: (...nodes) => appended.push(...nodes) });
	renderToolbar(); renderToolbar();
	assert.equal(tools.children.length, 3, 'one button even if the toolbar renders twice');
	const wrap = tools.children[2], button = wrap.children[1];
	assert.equal(wrap.id, 'source-date-read-toolbar'); assert.equal(appended.length, 0);
	assert.equal(button.textContent, '已读'); assert.equal(button.attrs['aria-pressed'], 'false');
	assert.equal(button.attrs.title, '标记为已读');
	await button.click();
	assert.equal(isRead(readPaper), true, 'toolbar marks the paper that owns the PDF');
	observers.get('obs').notify('modify', 'item', [readPaper.id]);
	assert.equal(button.attrs['aria-pressed'], 'true'); assert.equal(button.classList.has('active'), true);
	await setRead([readPaper], false); observers.get('obs').notify('modify', 'item', [readPaper.id]);
	assert.equal(button.attrs['aria-pressed'], 'false', 'follows changes made from the item list');
	// Without the annotation-tool group, fall back to Zotero's toolbar slot.
	const bareDoc = fakeDocument();
	readerListeners[0].handler({ reader: { itemID: pdf.id }, doc: bareDoc, append: (...nodes) => appended.push(...nodes) });
	assert.equal(appended.length, 1);

	await addon.shutdown();
	assert.equal(nodes.has('source-date-columns-read-style'), false, 'stylesheet removed on shutdown');
	assert.equal(tools.children.length, 2, 'toolbar button removed on shutdown');
	assert.equal(observers.size, 0);
	assert.equal(unregistered.length, 3);
	assert.equal(unregistered[0], "sourceDateColumnsRead");
	assert.equal(unregistered[1], "sourceDateColumnsPublicationYearMonth");
	assert.equal(unregistered[2], "sourceDateColumnsPublicationSource");

	// Online venue/date must stay paired even when Crossref has no date.
	const paper = item({ title: 'A long robotics paper title', repository: 'arXiv', date: '2025-01' }, 'preprint');
	const input = addon._test.inputFor(paper);
	const key = sandbox.SourceDateOnline.create({}).keyFor(input);
	await addon.startup('source-date-columns@local.zotero', {
		read: async () => ({ version: 1, records: { [key]: { state: 'matched', checkedAt: Date.now(),
			result: { source: 'RSS 2025', date: '' } } } }), getAuto: () => false,
	});
	assert.equal(addon._test.display(paper).source, 'RSS 2025');
	assert.equal(addon._test.display(paper).date, '', 'must not use arXiv upload date for RSS');
	await addon.shutdown();

	// A paper with no venue in Zotero, found on arXiv by title, shows arXiv + upload month.
	const bare = item({ title: 'π0.5: a Vision-Language-Action Model with Open-World Generalization' }, 'document');
	const bareKey = sandbox.SourceDateOnline.create({}).keyFor(addon._test.inputFor(bare));
	const journal = item({ title: 'A long robotics journal paper', publicationTitle: 'Science Robotics', date: '2024-02' });
	const journalKey = sandbox.SourceDateOnline.create({}).keyFor(addon._test.inputFor(journal));
	const arxivRecord = { state: 'unmatched', checkedAt: Date.now(), arxivDate: '2025-04', arxivID: '2504.16054' };
	await addon.startup('source-date-columns@local.zotero', {
		read: async () => ({ version: 4, records: { [bareKey]: arxivRecord, [journalKey]: arxivRecord } }),
		getAuto: () => false,
	});
	assert.equal(addon._test.display(bare).source, 'arXiv');
	assert.equal(addon._test.display(bare).date, '2025-04');
	assert.equal(addon._test.display(journal).source, 'Science Robotics', 'local venue wins over arXiv');
	assert.equal(addon._test.display(journal).date, '2024-02');
	await addon.shutdown();
}

testColumnLifecycle()
	.then(() => console.log("All source/date column tests passed."))
	.catch(error => {
		console.error(error);
		process.exitCode = 1;
	});
