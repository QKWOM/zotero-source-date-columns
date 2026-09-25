var SourceDateColumns;
var SourceDateOnline;

function log(message) {
	Zotero.debug("Source Date Columns: " + message);
}

function install() {
	log("Installed");
}

async function startup({ id, rootURI }) {
	log("Starting");
	Services.scriptloader.loadSubScript(rootURI + "online.js", null, "UTF-8");
	Services.scriptloader.loadSubScript(rootURI + "source-date-columns.js", null, "UTF-8");
	try {
		await SourceDateColumns.startup(id);
	} catch (error) {
		await SourceDateColumns.shutdown();
		throw error;
	}
}

async function shutdown() {
	log("Shutting down");
	if (SourceDateColumns) {
		await SourceDateColumns.shutdown().catch(error => {
			Zotero.logError(error);
		});
		SourceDateColumns = undefined;
		SourceDateOnline = undefined;
	}
}

function onMainWindowLoad({ window }) {
	SourceDateColumns?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
	SourceDateColumns?.onMainWindowUnload(window);
}

function uninstall() {
	log("Uninstalled");
}
