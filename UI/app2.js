/* ==========================================================================
   FaceFusion v4 — WreckUI Neural Console & FFMPEG Toolkit (app.js)
   Works directly from file:// via FaceFusion v4 permissive CORS headers.
   Includes:
   - Auto MP4/MOV/M4A moov-atom faststart repair on upload (prevents HTTP 415
     & ffprobe duration='N/A' ValueError)
   - Built-in FFMPEG Toolkit tab + standalone page support:
     1) Batch -movflags +faststart lossless byte-reordering (*_f.mp4)
     2) Lossless keyframe MP4 splitter (<500 MB API limit / duration chunks)
     3) One-click "Use as Target" / "Use as Source" & Download actions
   ========================================================================== */

'use strict';

/* ── Config & Persistence ────────────────────────────────────────────────── */
const Config = {
	get baseUrl() {
		return (localStorage.getItem('ff.baseUrl') || 'http://127.0.0.1:8000').replace(/\/+$/, '');
	},
	set baseUrl(v) {
		localStorage.setItem('ff.baseUrl', v.replace(/\/+$/, ''));
	},
	get apiKey() {
		return sessionStorage.getItem('ff.apiKey') || localStorage.getItem('ff.apiKey') || '';
	},
	setApiKey(v, remember) {
		sessionStorage.setItem('ff.apiKey', v);
		if (remember) localStorage.setItem('ff.apiKey', v);
		else localStorage.removeItem('ff.apiKey');
	},
	get wasConnected() {
		return localStorage.getItem('ff.wasConnected') === '1';
	},
	set wasConnected(v) {
		v ? localStorage.setItem('ff.wasConnected', '1') : localStorage.removeItem('ff.wasConnected');
	},
	get autoFaststart() {
		return localStorage.getItem('ff.autoFaststart') !== '0';
	},
	set autoFaststart(v) {
		localStorage.setItem('ff.autoFaststart', v ? '1' : '0');
	},
	get autoSaveFixed() {
		return localStorage.getItem('ff.autoSaveFixed') === '1';
	},
	set autoSaveFixed(v) {
		localStorage.setItem('ff.autoSaveFixed', v ? '1' : '0');
	}
};

/* Processors that require a source asset of a specific media kind */
const SOURCE_RULES = {
	face_swapper: 'image',
	lip_syncer: 'audio'
};

/* Custom AI / Faceswap SVG Icons for Processors */
const PROCESSOR_ICONS = {
	face_swapper: '<svg viewBox="0 0 24 24" class="p-ico"><path d="M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 14c0-2.2 2.2-4 5-4s5 1.8 5 4M14 4h6m0 0-2.5-2.5M20 4l-2.5 2.5M10 20H4m0 0 2.5-2.5M4 20l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	deep_swapper: '<svg viewBox="0 0 24 24" class="p-ico"><polygon points="12 2 21 7 21 17 12 22 3 17 3 7" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
	face_enhancer: '<svg viewBox="0 0 24 24" class="p-ico"><path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3Zm6 12 .9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
	frame_enhancer: '<svg viewBox="0 0 24 24" class="p-ico"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	face_editor: '<svg viewBox="0 0 24 24" class="p-ico"><path d="M4 8h16M4 16h16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="8" r="2.2" fill="currentColor"/><circle cx="15" cy="16" r="2.2" fill="currentColor"/></svg>',
	expression_restorer: '<svg viewBox="0 0 24 24" class="p-ico"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.5 14.5c1 1.3 2.2 2 3.5 2s2.5-.7 3.5-2M9 9.5h.01M15 9.5h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
	lip_syncer: '<svg viewBox="0 0 24 24" class="p-ico"><path d="M3 12h3l2-5 4 10 4-8 2 3h3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	age_modifier: '<svg viewBox="0 0 24 24" class="p-ico"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	frame_colorizer: '<svg viewBox="0 0 24 24" class="p-ico"><path d="M12 3a9 9 0 1 0 0 18c1.5 0 2.5-1 2.5-2.2 0-.8-.5-1.5-1-2.1-.4-.5-.5-1.2.2-1.7h2.8A4.5 4.5 0 0 0 21 10.5C21 6.4 16.9 3 12 3Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
	background_remover: '<svg viewBox="0 0 24 24" class="p-ico"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 3"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M7 19c1-2.5 2.8-4 5-4s4 1.5 5 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
	face_debugger: '<svg viewBox="0 0 24 24" class="p-ico"><path d="M4 8V5a1 1 0 0 1 1-1h3M20 8V5a1 1 0 0 0-1-1h-3M4 16v3a1 1 0 0 0 1 1h3M20 16v3a1 1 0 0 1-1 1h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>'
};

/* ── DOM Helper & References ─────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const dom = {};

function bindDom() {
	const ids = [
		'connDot', 'connLabel', 'sessionTtl', 'telemetry', 'telemetryEmpty',
		'btnSettings', 'btnDisconnect', 'processorChips', 'optionsGroups',
		'optionsPlaceholder', 'optionFilter', 'syncState', 'zoneSource',
		'inputSource', 'sourceEmpty', 'sourceThumbs', 'sourceLoading',
		'btnSourceFaces', 'zoneTarget', 'inputTarget', 'targetEmpty',
		'targetThumbs', 'targetLoading', 'btnTargetFaces', 'btnRun', 'runHint',
		'outputCanvas', 'outputEmpty', 'outputProgress', 'jobPhase', 'jobDetail',
		'outputImage', 'outputVideo', 'viewSwitch', 'viewResult', 'viewCompare',
		'compareWrap', 'compareBase', 'compareTopWrap', 'compareTop',
		'compareSlider', 'btnDownload', 'jobsList', 'jobsEmpty', 'btnJobsRefresh',
		'tabBtnBatch', 'tabBtnStream', 'tabBtnToolkit', 'tabBatch', 'tabStream',
		'tabToolkit', 'btnStreamStart', 'btnStreamImage', 'inputStreamImage',
		'btnStreamStop', 'streamFps', 'streamInput', 'streamInputEmpty',
		'streamOutput', 'streamOutputEmpty', 'settingsModal', 'cfgUrl', 'cfgKey',
		'cfgRemember', 'btnConnect', 'btnSettingsClose', 'facesModal',
		'facesImage', 'facesLoading', 'btnFacesClose', 'toasts',
		/* Toolkit elements */
		'zoneFaststart', 'inputFaststart', 'faststartList', 'btnFaststartAll',
		'btnFaststartDownloadAll', 'btnFaststartClear', 'chkAutoFaststart',
		'chkAutoSaveFixed', 'zoneSplitter', 'inputSplitter', 'splitMode',
		'splitValue', 'splitValueLabel', 'btnSplitRun', 'splitterList',
		'ffmpegCmdBox', 'btnCopyCmd'
	];
	for (const id of ids) dom[id] = $(id);
}

/* ── Runtime State ───────────────────────────────────────────────────────── */
const App = {
	caps: null,
	options: {},
	lastGood: {},
	controls: new Map(),
	assets: [],
	selectedSources: new Set(),
	selectedTarget: null,
	jobPoll: null,
	jobsTimer: null,
	busy: false,
	blobUrls: new Set(),
	faststartQueue: [],   // { id, file, status, atomPos, fixedFile, url, info }
	splitQueue: [],       // { id, file, name, size, duration, url }
	splitSourceFile: null
};

/* ── Toast Notifications ─────────────────────────────────────────────────── */
function toast(message, type = 'info', ms = 4400) {
	if (!dom.toasts) {
		const c = document.createElement('div');
		c.id = 'toasts';
		c.className = 'toasts';
		document.body.appendChild(c);
		dom.toasts = c;
	}
	const el = document.createElement('div');
	el.className = 'toast' + (type === 'error' ? ' t-err' : type === 'ok' ? ' t-ok' : type === 'warn' ? ' t-warn' : '');
	el.textContent = message;
	dom.toasts.appendChild(el);
	setTimeout(() => {
		el.classList.add('is-out');
		setTimeout(() => el.remove(), 300);
	}, ms);
}

/* ==========================================================================
   PURE-JS ISO BMFF / MP4 ENGINE (Faststart moov Repair & Lossless Splitter)
   ========================================================================== */
const Mp4Toolkit = {
	CONTAINER_TYPES: new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'udta', 'mvex']),

	isMp4Family(file) {
		if (!file || !file.name) return false;
		return /\.(mp4|mov|m4v|m4a)$/i.test(file.name) ||
			['video/mp4', 'video/quicktime', 'video/x-m4v', 'audio/mp4'].includes(file.type);
	},

	readFourCC(view, offset) {
		let s = '';
		for (let i = 0; i < 4; i++) s += String.fromCharCode(view.getUint8(offset + i));
		return s;
	},

	writeFourCC(view, offset, str) {
		for (let i = 0; i < 4; i++) view.setUint8(offset + i, str.charCodeAt(i) || 32);
	},

	/**
	 * Parses top-level or nested ISO BMFF atoms/boxes in a buffer range.
	 */
	parseBoxes(buffer, start = 0, end = buffer.byteLength) {
		const view = new DataView(buffer);
		const boxes = [];
		let pos = start;

		while (pos + 8 <= end) {
			let size = view.getUint32(pos, false);
			const type = this.readFourCC(view, pos + 4);
			let headerSize = 8;

			if (size === 1) {
				if (pos + 16 > end) break;
				const hi = view.getUint32(pos + 8, false);
				const lo = view.getUint32(pos + 12, false);
				size = hi * 4294967296 + lo;
				headerSize = 16;
			} else if (size === 0) {
				size = end - pos;
			}

			if (size < headerSize || pos + size > end) break;

			boxes.push({
				type,
				offset: pos,
				size,
				headerSize,
				dataOffset: pos + headerSize,
				end: pos + size
			});
			pos += size;
		}
		return boxes;
	},

	/**
	 * Inspects an MP4/MOV/M4A file to see where the `moov` atom sits relative to `mdat`.
	 */
	async inspect(file) {
		const buffer = await file.arrayBuffer();
		const boxes = this.parseBoxes(buffer);
		const moov = boxes.find(b => b.type === 'moov');
		const mdat = boxes.find(b => b.type === 'mdat');

		if (!moov || !mdat) {
			return { valid: false, needsFaststart: false, reason: 'Missing moov or mdat atom', buffer, boxes };
		}
		const needsFaststart = moov.offset > mdat.offset;
		const meta = this.extractMoovSummary(buffer, moov);
		return {
			valid: true,
			needsFaststart,
			moovOffset: moov.offset,
			mdatOffset: mdat.offset,
			moovSize: moov.size,
			duration: meta.duration,
			timescale: meta.timescale,
			buffer,
			boxes
		};
	},

	extractMoovSummary(buffer, moovBox) {
		const view = new DataView(buffer);
		const children = this.parseBoxes(buffer, moovBox.dataOffset, moovBox.end);
		const mvhd = children.find(b => b.type === 'mvhd');
		if (!mvhd) return { duration: null, timescale: null };

		const version = view.getUint8(mvhd.dataOffset);
		let timescale = 1000;
		let durationUnits = 0;
		if (version === 1) {
			timescale = view.getUint32(mvhd.dataOffset + 20, false);
			const hi = view.getUint32(mvhd.dataOffset + 24, false);
			const lo = view.getUint32(mvhd.dataOffset + 28, false);
			durationUnits = hi * 4294967296 + lo;
		} else {
			timescale = view.getUint32(mvhd.dataOffset + 12, false);
			durationUnits = view.getUint32(mvhd.dataOffset + 16, false);
		}
		const duration = timescale > 0 ? durationUnits / timescale : null;
		return { duration, timescale };
	},

	/**
	 * Recursively walks inside `moov` and shifts all `stco` (32-bit) and `co64` (64-bit)
	 * chunk offsets by `delta` bytes. Returns false if a 32-bit `stco` overflows 4 GiB.
	 */
	shiftChunkOffsets(moovBytes, delta) {
		const buf = moovBytes.buffer.slice(moovBytes.byteOffset, moovBytes.byteOffset + moovBytes.byteLength);
		const view = new DataView(buf);
		let overflow = false;

		const walk = (start, end) => {
			const boxes = this.parseBoxes(buf, start, end);
			for (const b of boxes) {
				if (this.CONTAINER_TYPES.has(b.type)) {
					walk(b.dataOffset, b.end);
				} else if (b.type === 'stco') {
					const count = view.getUint32(b.dataOffset + 4, false);
					let ptr = b.dataOffset + 8;
					for (let i = 0; i < count; i++, ptr += 4) {
						const oldVal = view.getUint32(ptr, false);
						const nextVal = oldVal + delta;
						if (nextVal > 0xFFFFFFFF || nextVal < 0) {
							overflow = true;
							return;
						}
						view.setUint32(ptr, nextVal, false);
					}
				} else if (b.type === 'co64') {
					const count = view.getUint32(b.dataOffset + 4, false);
					let ptr = b.dataOffset + 8;
					for (let i = 0; i < count; i++, ptr += 8) {
						const hi = view.getUint32(ptr, false);
						const lo = view.getUint32(ptr + 4, false);
						const nextVal = (hi * 4294967296 + lo) + delta;
						view.setUint32(ptr, Math.floor(nextVal / 4294967296), false);
						view.setUint32(ptr + 4, nextVal >>> 0, false);
					}
				}
			}
		};

		const root = this.parseBoxes(buf, 0, buf.byteLength)[0];
		if (root) walk(root.dataOffset, root.end);
		if (overflow) throw new Error('stco 32-bit chunk offset overflow (>4GB).');
		return new Uint8Array(buf);
	},

	/**
	 * Performs lossless `-movflags +faststart` in memory.
	 * Moves `moov` right before the first `mdat` and updates all chunk offsets.
	 */
	async toFaststart(file, force = false) {
		const info = await this.inspect(file);
		if (!info.valid) {
			throw new Error(info.reason || 'Not a standard MP4/MOV container.');
		}

		const fixedName = file.name.replace(/(\.[^.]+)$/, '_f$1');

		if (!info.needsFaststart && !force) {
			return {
				changed: false,
				file: new File([file], fixedName, { type: file.type || 'video/mp4' }),
				originalName: file.name,
				fixedName,
				duration: info.duration
			};
		}

		const { buffer, boxes } = info;
		const srcBytes = new Uint8Array(buffer);
		const firstMdatIdx = boxes.findIndex(b => b.type === 'mdat');
		const moovIdx = boxes.findIndex(b => b.type === 'moov');

		if (moovIdx < firstMdatIdx) {
			return {
				changed: false,
				file: new File([file], fixedName, { type: file.type || 'video/mp4' }),
				originalName: file.name,
				fixedName,
				duration: info.duration
			};
		}

		const moovBox = boxes[moovIdx];
		const rawMoov = srcBytes.subarray(moovBox.offset, moovBox.end);

		// Every box between firstMdatIdx and moovIdx shifts forward by moovBox.size
		const patchedMoov = this.shiftChunkOffsets(rawMoov, moovBox.size);

		const parts = [];
		for (let i = 0; i < boxes.length; i++) {
			if (i === firstMdatIdx) {
				parts.push(patchedMoov);
			}
			if (i !== moovIdx) {
				parts.push(srcBytes.subarray(boxes[i].offset, boxes[i].end));
			}
		}

		const fixedFile = new File(parts, fixedName, {
			type: file.type || 'video/mp4',
			lastModified: Date.now()
		});

		return {
			changed: true,
			file: fixedFile,
			originalName: file.name,
			fixedName,
			duration: info.duration
		};
	},

	/**
	 * Automatically checks & fixes an MP4/MOV/M4A file before uploading to FaceFusion.
	 */
	async ensureFaststartForUpload(file) {
		if (!Config.autoFaststart || !this.isMp4Family(file)) {
			return { file, repaired: false };
		}
		try {
			const res = await this.toFaststart(file, false);
			if (res.changed) {
				if (Config.autoSaveFixed) {
					triggerDownload(res.file, res.fixedName);
				}
				return { file: res.file, repaired: true, fixedName: res.fixedName };
			}
		} catch (err) {
			console.warn('Auto-faststart check skipped:', err);
		}
		return { file, repaired: false };
	},

	/* ── Lossless Keyframe MP4 Splitter (<500 MB API Limit) ─────────────── */

	parseTrackTables(buffer, trakBox) {
		const view = new DataView(buffer);
		const trakChildren = this.parseBoxes(buffer, trakBox.dataOffset, trakBox.end);
		const tkhd = trakChildren.find(b => b.type === 'tkhd');
		const mdia = trakChildren.find(b => b.type === 'mdia');
		if (!tkhd || !mdia) return null;

		const mdiaChildren = this.parseBoxes(buffer, mdia.dataOffset, mdia.end);
		const mdhd = mdiaChildren.find(b => b.type === 'mdhd');
		const hdlr = mdiaChildren.find(b => b.type === 'hdlr');
		const minf = mdiaChildren.find(b => b.type === 'minf');
		if (!mdhd || !hdlr || !minf) return null;

		const handlerType = this.readFourCC(view, hdlr.dataOffset + 8);
		const mdhdVer = view.getUint8(mdhd.dataOffset);
		const timescale = mdhdVer === 1
			? view.getUint32(mdhd.dataOffset + 20, false)
			: view.getUint32(mdhd.dataOffset + 12, false);

		const minfChildren = this.parseBoxes(buffer, minf.dataOffset, minf.end);
		const stbl = minfChildren.find(b => b.type === 'stbl');
		if (!stbl) return null;

		const stblChildren = this.parseBoxes(buffer, stbl.dataOffset, stbl.end);
		const stsd = stblChildren.find(b => b.type === 'stsd');
		const stts = stblChildren.find(b => b.type === 'stts');
		const ctts = stblChildren.find(b => b.type === 'ctts');
		const stss = stblChildren.find(b => b.type === 'stss');
		const stsc = stblChildren.find(b => b.type === 'stsc');
		const stsz = stblChildren.find(b => b.type === 'stsz');
		const stco = stblChildren.find(b => b.type === 'stco');
		const co64 = stblChildren.find(b => b.type === 'co64');

		if (!stsd || !stts || !stsc || !stsz || (!stco && !co64)) return null;

		// 1. Sample sizes (stsz)
		const defaultSize = view.getUint32(stsz.dataOffset + 4, false);
		const sampleCount = view.getUint32(stsz.dataOffset + 8, false);
		const sampleSizes = new Uint32Array(sampleCount);
		if (defaultSize !== 0) {
			sampleSizes.fill(defaultSize);
		} else {
			for (let i = 0; i < sampleCount; i++) {
				sampleSizes[i] = view.getUint32(stsz.dataOffset + 12 + i * 4, false);
			}
		}

		// 2. Chunk offsets (stco / co64)
		const chunkEntryBox = stco || co64;
		const is64 = !!co64;
		const chunkCount = view.getUint32(chunkEntryBox.dataOffset + 4, false);
		const chunkOffsets = new Float64Array(chunkCount);
		for (let i = 0; i < chunkCount; i++) {
			if (is64) {
				const hi = view.getUint32(chunkEntryBox.dataOffset + 8 + i * 8, false);
				const lo = view.getUint32(chunkEntryBox.dataOffset + 12 + i * 8, false);
				chunkOffsets[i] = hi * 4294967296 + lo;
			} else {
				chunkOffsets[i] = view.getUint32(chunkEntryBox.dataOffset + 8 + i * 4, false);
			}
		}

		// 3. Sample-to-chunk (stsc)
		const stscCount = view.getUint32(stsc.dataOffset + 4, false);
		const stscEntries = [];
		for (let i = 0; i < stscCount; i++) {
			const base = stsc.dataOffset + 8 + i * 12;
			stscEntries.push({
				firstChunk: view.getUint32(base, false), // 1-based
				samplesPerChunk: view.getUint32(base + 4, false),
				sampleDescIdx: view.getUint32(base + 8, false)
			});
		}

		// 4. Time-to-sample deltas (stts)
		const sttsCount = view.getUint32(stts.dataOffset + 4, false);
		const sampleDeltas = new Uint32Array(sampleCount);
		const sampleTimestamps = new Float64Array(sampleCount);
		let sIdx = 0;
		let accDts = 0;
		for (let i = 0; i < sttsCount; i++) {
			const base = stts.dataOffset + 8 + i * 8;
			const cnt = view.getUint32(base, false);
			const delta = view.getUint32(base + 4, false);
			for (let j = 0; j < cnt && sIdx < sampleCount; j++) {
				sampleTimestamps[sIdx] = accDts;
				sampleDeltas[sIdx] = delta;
				accDts += delta;
				sIdx++;
			}
		}

		// 5. Composition offsets (ctts) if present
		let sampleCtts = null;
		let cttsVersion = 0;
		if (ctts) {
			cttsVersion = view.getUint8(ctts.dataOffset);
			const cttsCount = view.getUint32(ctts.dataOffset + 4, false);
			sampleCtts = new Int32Array(sampleCount);
			let cIdx = 0;
			for (let i = 0; i < cttsCount; i++) {
				const base = ctts.dataOffset + 8 + i * 8;
				const cnt = view.getUint32(base, false);
				const offsetVal = view.getInt32(base + 4, false);
				for (let j = 0; j < cnt && cIdx < sampleCount; j++) {
					sampleCtts[cIdx++] = offsetVal;
				}
			}
		}

		// 6. Sync samples / keyframes (stss)
		let syncSet = null;
		if (stss) {
			const syncCount = view.getUint32(stss.dataOffset + 4, false);
			syncSet = new Set();
			for (let i = 0; i < syncCount; i++) {
				syncSet.add(view.getUint32(stss.dataOffset + 8 + i * 4, false) - 1); // 0-based
			}
		}

		// 7. Compute exact byte offset of each sample in file
		const sampleOffsets = new Float64Array(sampleCount);
		const sampleDescIndices = new Uint32Array(sampleCount);
		let curSample = 0;
		for (let c = 0; c < chunkCount && curSample < sampleCount; c++) {
			const chunkNum = c + 1;
			let activeEntry = stscEntries[0];
			for (const e of stscEntries) {
				if (e.firstChunk <= chunkNum) activeEntry = e;
				else break;
			}
			let byteCursor = chunkOffsets[c];
			for (let k = 0; k < activeEntry.samplesPerChunk && curSample < sampleCount; k++) {
				sampleOffsets[curSample] = byteCursor;
				sampleDescIndices[curSample] = activeEntry.sampleDescIdx;
				byteCursor += sampleSizes[curSample];
				curSample++;
			}
		}

		return {
			trakBox, tkhd, mdia, mdhd, hdlr, minf, stbl, stsd,
			handlerType, timescale, sampleCount,
			sampleSizes, sampleOffsets, sampleDeltas, sampleTimestamps,
			sampleCtts, cttsVersion, syncSet, sampleDescIndices,
			totalDurationUnits: accDts
		};
	},

	makeBox(type, payloadArrays) {
		let payloadLen = 0;
		for (const p of payloadArrays) payloadLen += p.byteLength;
		const out = new Uint8Array(8 + payloadLen);
		const view = new DataView(out.buffer);
		view.setUint32(0, out.byteLength, false);
		this.writeFourCC(view, 4, type);
		let offset = 8;
		for (const p of payloadArrays) {
			out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), offset);
			offset += p.byteLength;
		}
		return out;
	},

	buildSlicedTrack(buffer, track, startSample, endSample, newSampleOffsets, movieTimescale) {
		const srcBytes = new Uint8Array(buffer);
		const count = endSample - startSample;

		// 1. stsd (unchanged)
		const stsdBytes = srcBytes.subarray(track.stsd.offset, track.stsd.end);

		// 2. stts (run-length encoded deltas)
		const sttsRuns = [];
		for (let i = startSample; i < endSample; i++) {
			const d = track.sampleDeltas[i];
			if (sttsRuns.length && sttsRuns[sttsRuns.length - 1].delta === d) {
				sttsRuns[sttsRuns.length - 1].count++;
			} else {
				sttsRuns.push({ count: 1, delta: d });
			}
		}
		const sttsPayload = new Uint8Array(8 + sttsRuns.length * 8);
		const sttsView = new DataView(sttsPayload.buffer);
		sttsView.setUint32(4, sttsRuns.length, false);
		sttsRuns.forEach((r, idx) => {
			sttsView.setUint32(8 + idx * 8, r.count, false);
			sttsView.setUint32(12 + idx * 8, r.delta, false);
		});
		const sttsBox = this.makeBox('stts', [sttsPayload]);

		// 3. ctts (if present)
		const extraStbl = [];
		if (track.sampleCtts) {
			const cttsRuns = [];
			for (let i = startSample; i < endSample; i++) {
				const off = track.sampleCtts[i];
				if (cttsRuns.length && cttsRuns[cttsRuns.length - 1].offset === off) {
					cttsRuns[cttsRuns.length - 1].count++;
				} else {
					cttsRuns.push({ count: 1, offset: off });
				}
			}
			const cttsPayload = new Uint8Array(8 + cttsRuns.length * 8);
			const cttsView = new DataView(cttsPayload.buffer);
			cttsView.setUint8(0, track.cttsVersion);
			cttsView.setUint32(4, cttsRuns.length, false);
			cttsRuns.forEach((r, idx) => {
				cttsView.setUint32(8 + idx * 8, r.count, false);
				cttsView.setInt32(12 + idx * 8, r.offset, false);
			});
			extraStbl.push(this.makeBox('ctts', [cttsPayload]));
		}

		// 4. stss (if video has sync samples)
		if (track.syncSet) {
			const syncList = [];
			for (let i = startSample; i < endSample; i++) {
				if (track.syncSet.has(i)) syncList.push(i - startSample + 1);
			}
			const stssPayload = new Uint8Array(8 + syncList.length * 4);
			const stssView = new DataView(stssPayload.buffer);
			stssView.setUint32(4, syncList.length, false);
			syncList.forEach((val, idx) => stssView.setUint32(8 + idx * 4, val, false));
			extraStbl.push(this.makeBox('stss', [stssPayload]));
		}

		// 5. stsc (1 sample per chunk for simplicity and universal compatibility)
		const stscPayload = new Uint8Array(8 + 12);
		const stscView = new DataView(stscPayload.buffer);
		stscView.setUint32(4, 1, false);
		stscView.setUint32(8, 1, false);
		stscView.setUint32(12, 1, false);
		stscView.setUint32(16, track.sampleDescIndices[startSample] || 1, false);
		const stscBox = this.makeBox('stsc', [stscPayload]);

		// 6. stsz
		const stszPayload = new Uint8Array(12 + count * 4);
		const stszView = new DataView(stszPayload.buffer);
		stszView.setUint32(4, 0, false);
		stszView.setUint32(8, count, false);
		for (let i = 0; i < count; i++) {
			stszView.setUint32(12 + i * 4, track.sampleSizes[startSample + i], false);
		}
		const stszBox = this.makeBox('stsz', [stszPayload]);

		// 7. stco (32-bit chunk offsets; 1 chunk per sample)
		const stcoPayload = new Uint8Array(8 + count * 4);
		const stcoView = new DataView(stcoPayload.buffer);
		stcoView.setUint32(4, count, false);
		for (let i = 0; i < count; i++) {
			stcoView.setUint32(8 + i * 4, newSampleOffsets[i], false);
		}
		const stcoBox = this.makeBox('stco', [stcoPayload]);

		const stblBox = this.makeBox('stbl', [stsdBytes, sttsBox, ...extraStbl, stscBox, stszBox, stcoBox]);

		// Rebuild minf (keep non-stbl children like vmhd/smhd/dinf)
		const minfChildren = this.parseBoxes(buffer, track.minf.dataOffset, track.minf.end)
			.filter(b => b.type !== 'stbl')
			.map(b => srcBytes.subarray(b.offset, b.end));
		const minfBox = this.makeBox('minf', [...minfChildren, stblBox]);

		// Compute track segment duration
		let segTrackDuration = 0;
		for (let i = startSample; i < endSample; i++) segTrackDuration += track.sampleDeltas[i];

		// Patch mdhd duration
		const mdhdCopy = new Uint8Array(srcBytes.subarray(track.mdhd.offset, track.mdhd.end));
		const mdhdView = new DataView(mdhdCopy.buffer);
		const mdhdVer = mdhdView.getUint8(8);
		if (mdhdVer === 1) {
			mdhdView.setUint32(8 + 24, Math.floor(segTrackDuration / 4294967296), false);
			mdhdView.setUint32(8 + 28, segTrackDuration >>> 0, false);
		} else {
			mdhdView.setUint32(8 + 16, segTrackDuration >>> 0, false);
		}

		const hdlrCopy = srcBytes.subarray(track.hdlr.offset, track.hdlr.end);
		const mdiaBox = this.makeBox('mdia', [mdhdCopy, hdlrCopy, minfBox]);

		// Patch tkhd duration (in movieTimescale units)
		const tkhdCopy = new Uint8Array(srcBytes.subarray(track.tkhd.offset, track.tkhd.end));
		const tkhdView = new DataView(tkhdCopy.buffer);
		const tkhdVer = tkhdView.getUint8(8);
		const movieDurationUnits = Math.round((segTrackDuration / track.timescale) * movieTimescale);
		if (tkhdVer === 1) {
			tkhdView.setUint32(8 + 28, Math.floor(movieDurationUnits / 4294967296), false);
			tkhdView.setUint32(8 + 32, movieDurationUnits >>> 0, false);
		} else {
			tkhdView.setUint32(8 + 20, movieDurationUnits >>> 0, false);
		}

		return {
			trakBox: this.makeBox('trak', [tkhdCopy, mdiaBox]),
			durationSec: segTrackDuration / track.timescale
		};
	},

	/**
	 * Splits an MP4 file losslessly on video keyframes into segments with `moov` at the front.
	 * @param {File} file
	 * @param {Object} opts - { mode: 'size' | 'duration', maxBytes: number, segmentSeconds: number }
	 */
	async splitMp4(file, { mode = 'size', maxBytes = 450 * 1024 * 1024, segmentSeconds = 60 } = {}) {
		const buffer = await file.arrayBuffer();
		const srcBytes = new Uint8Array(buffer);
		const topBoxes = this.parseBoxes(buffer);
		const ftyp = topBoxes.find(b => b.type === 'ftyp');
		const moov = topBoxes.find(b => b.type === 'moov');
		if (!ftyp || !moov) throw new Error('Invalid MP4 container (missing ftyp or moov).');

		const moovChildren = this.parseBoxes(buffer, moov.dataOffset, moov.end);
		const mvhd = moovChildren.find(b => b.type === 'mvhd');
		if (!mvhd) throw new Error('Missing mvhd header inside moov.');

		const mvhdSummary = this.extractMoovSummary(buffer, moov);
		const movieTimescale = mvhdSummary.timescale || 1000;

		const tracks = moovChildren
			.filter(b => b.type === 'trak')
			.map(t => this.parseTrackTables(buffer, t))
			.filter(Boolean);

		const videoTrack = tracks.find(t => t.handlerType === 'vide') || tracks[0];
		if (!videoTrack || videoTrack.sampleCount === 0) {
			throw new Error('No splittable video track found in container.');
		}

		// Collect candidate split points (keyframes on video track, or every 30 samples if no stss)
		const keyframes = [];
		if (videoTrack.syncSet && videoTrack.syncSet.size > 1) {
			for (let i = 0; i < videoTrack.sampleCount; i++) {
				if (videoTrack.syncSet.has(i)) keyframes.push(i);
			}
		} else {
			for (let i = 0; i < videoTrack.sampleCount; i += 30) keyframes.push(i);
		}
		if (keyframes[0] !== 0) keyframes.unshift(0);

		// Determine segment intervals [startTimeSec, endTimeSec]
		const segmentsMeta = [];
		let segStartIdx = 0;

		const estimateRangeBytes = (tStartSec, tEndSec) => {
			let bytes = 0;
			for (const tr of tracks) {
				const s0 = this.findSampleAtTime(tr, tStartSec);
				const s1 = this.findSampleAtTime(tr, tEndSec, true);
				for (let i = s0; i < s1; i++) bytes += tr.sampleSizes[i];
			}
			return bytes + 512 * 1024; // +512 KB margin for headers
		};

		for (let k = 1; k < keyframes.length; k++) {
			const candSample = keyframes[k];
			const startSample = keyframes[segStartIdx];
			const tStart = videoTrack.sampleTimestamps[startSample] / videoTrack.timescale;
			const tCand = videoTrack.sampleTimestamps[candSample] / videoTrack.timescale;

			if (mode === 'duration') {
				if (tCand - tStart >= segmentSeconds) {
					segmentsMeta.push({ vStart: startSample, vEnd: candSample, tStart, tEnd: tCand });
					segStartIdx = k;
				}
			} else {
				const estBytes = estimateRangeBytes(tStart, tCand);
				if (estBytes >= maxBytes && k > segStartIdx + 1) {
					const prevSample = keyframes[k - 1];
					const tPrev = videoTrack.sampleTimestamps[prevSample] / videoTrack.timescale;
					segmentsMeta.push({ vStart: startSample, vEnd: prevSample, tStart, tEnd: tPrev });
					segStartIdx = k - 1;
					k--; // re-evaluate from new start
				} else if (estBytes >= maxBytes) {
					segmentsMeta.push({ vStart: startSample, vEnd: candSample, tStart, tEnd: tCand });
					segStartIdx = k;
				}
			}
		}

		// Final remaining segment
		const finalStartSample = keyframes[segStartIdx];
		const finalStartSec = videoTrack.sampleTimestamps[finalStartSample] / videoTrack.timescale;
		const finalEndSec = videoTrack.totalDurationUnits / videoTrack.timescale;
		segmentsMeta.push({
			vStart: finalStartSample,
			vEnd: videoTrack.sampleCount,
			tStart: finalStartSec,
			tEnd: finalEndSec
		});

		// Build standalone faststart MP4 file for each segment
		const ftypBytes = srcBytes.subarray(ftyp.offset, ftyp.end);
		const baseStem = file.name.replace(/\.[^.]+$/, '');
		const extMatch = file.name.match(/\.[^.]+$/);
		const ext = extMatch ? extMatch[0] : '.mp4';
		const results = [];

		for (let idx = 0; idx < segmentsMeta.length; idx++) {
			const seg = segmentsMeta[idx];
			const trackSlices = tracks.map(tr => {
				if (tr === videoTrack) {
					return { track: tr, s0: seg.vStart, s1: seg.vEnd };
				}
				return {
					track: tr,
					s0: this.findSampleAtTime(tr, seg.tStart),
					s1: idx === segmentsMeta.length - 1
						? tr.sampleCount
						: this.findSampleAtTime(tr, seg.tEnd, true)
				};
			});

			// Calculate relative offsets inside new mdat payload
			let mdatPayloadSize = 0;
			const relativeOffsetsPerTrack = [];
			for (const slice of trackSlices) {
				const count = Math.max(0, slice.s1 - slice.s0);
				const relOffsets = new Uint32Array(count);
				for (let i = 0; i < count; i++) {
					relOffsets[i] = mdatPayloadSize;
					mdatPayloadSize += slice.track.sampleSizes[slice.s0 + i];
				}
				relativeOffsetsPerTrack.push(relOffsets);
			}

			// First pass: build dummy moov with 0-based offsets to measure exact moov byteLength
			const dummyTraks = trackSlices.map((slice, tIdx) =>
				this.buildSlicedTrack(buffer, slice.track, slice.s0, slice.s1, relativeOffsetsPerTrack[tIdx], movieTimescale)
			);

			const segDurationSec = Math.max(...dummyTraks.map(d => d.durationSec), 0.04);
			const mvhdCopy = new Uint8Array(srcBytes.subarray(mvhd.offset, mvhd.end));
			const mvhdView = new DataView(mvhdCopy.buffer);
			const mvhdVer = mvhdView.getUint8(8);
			const segMovieUnits = Math.round(segDurationSec * movieTimescale);
			if (mvhdVer === 1) {
				mvhdView.setUint32(8 + 24, Math.floor(segMovieUnits / 4294967296), false);
				mvhdView.setUint32(8 + 28, segMovieUnits >>> 0, false);
			} else {
				mvhdView.setUint32(8 + 16, segMovieUnits >>> 0, false);
			}

			const dummyMoov = this.makeBox('moov', [mvhdCopy, ...dummyTraks.map(d => d.trakBox)]);
			const mdatHeaderSize = 8;
			const baseDataOffset = ftypBytes.byteLength + dummyMoov.byteLength + mdatHeaderSize;

			// Second pass: shift moov chunk offsets by baseDataOffset so moov sits at the front (faststart!)
			const finalMoov = this.shiftChunkOffsets(dummyMoov, baseDataOffset);

			// Assemble mdat box header + sample slices
			const mdatHeader = new Uint8Array(8);
			const mdatHeaderView = new DataView(mdatHeader.buffer);
			mdatHeaderView.setUint32(0, 8 + mdatPayloadSize, false);
			this.writeFourCC(mdatHeaderView, 4, 'mdat');

			const blobParts = [ftypBytes, finalMoov, mdatHeader];
			for (const slice of trackSlices) {
				for (let i = slice.s0; i < slice.s1; i++) {
					const off = slice.track.sampleOffsets[i];
					const sz = slice.track.sampleSizes[i];
					blobParts.push(srcBytes.subarray(off, off + sz));
				}
			}

			const partNum = String(idx + 1).padStart(2, '0');
			const segName = `${baseStem}_part${partNum}_f${ext}`;
			const segFile = new File(blobParts, segName, {
				type: file.type || 'video/mp4',
				lastModified: Date.now()
			});

			results.push({
				file: segFile,
				name: segName,
				size: segFile.size,
				duration: segDurationSec,
				startTime: seg.tStart,
				endTime: seg.tEnd
			});
		}

		return results;
	},

	findSampleAtTime(track, timeSec, Ceiled = false) {
		const targetUnits = timeSec * track.timescale;
		const ts = track.sampleTimestamps;
		let lo = 0, hi = track.sampleCount - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >>> 1;
			if (ts[mid] < targetUnits) lo = mid + 1;
			else hi = mid - 1;
		}
		return Math.min(track.sampleCount, Math.max(0, Ceiled ? lo : Math.max(0, lo)));
	}
};

/* ── Helper Utilities ────────────────────────────────────────────────────── */
function formatBytes(bytes) {
	if (!bytes || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB'];
	const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	return `${(bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 2 : 1)} ${units[i]}`;
}

function formatDuration(sec) {
	if (!sec || !isFinite(sec)) return '--:--';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function triggerDownload(blobOrFile, filename) {
	const url = URL.createObjectURL(blobOrFile);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename || blobOrFile.name || 'video_f.mp4';
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 15000);
}

/**
 * Extracts the first JPEG frame from a `multipart/mixed` stream (FaceFusion v4 update)
 * or returns the raw blob if it's already `image/jpeg`.
 */
async function extractCaptureBlob(res) {
	const ct = (res.headers.get('content-type') || '').toLowerCase();
	const rawBlob = await res.blob();
	if (!ct.includes('multipart')) return rawBlob;

	const buf = await rawBlob.arrayBuffer();
	const bytes = new Uint8Array(buf);
	// Locate JPEG SOI (0xFF 0xD8 0xFF) and EOI (0xFF 0xD9)
	let start = -1;
	for (let i = 0; i < bytes.length - 2; i++) {
		if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
			start = i;
			break;
		}
	}
	if (start === -1) return rawBlob;

	let end = bytes.length;
	for (let i = start + 3; i < bytes.length - 1; i++) {
		if (bytes[i] === 0xFF && bytes[i + 1] === 0xD9) {
			end = i + 2;
			break;
		}
	}
	return new Blob([bytes.subarray(start, end)], { type: 'image/jpeg' });
}

/* ── API Client ──────────────────────────────────────────────────────────── */
class ApiError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const Api = {
	async call(path, { method = 'GET', body, form, blob = false } = {}, retried = false) {
		const headers = {};
		if (Session.accessToken) headers['Authorization'] = `Bearer ${Session.accessToken}`;
		if (body !== undefined && !form) headers['Content-Type'] = 'application/json';

		let res;
		try {
			res = await fetch(Config.baseUrl + path, {
				method,
				headers,
				body: form ? form : body !== undefined ? JSON.stringify(body) : undefined
			});
		} catch {
			throw new ApiError(0, 'API unreachable at ' + Config.baseUrl);
		}

		if (res.status === 401 && !retried && !path.startsWith('/session')) {
			const ok = await Session.refresh();
			if (ok) return Api.call(path, { method, body, form, blob }, true);
			Session.drop('Session expired — reconnect.');
			throw new ApiError(401, 'Session expired');
		}

		if (!res.ok) {
			let message = `HTTP ${res.status}`;
			try {
				const j = await res.json();
				if (j && j.message) message = j.message;
			} catch { /* ignore */ }
			if (res.status === 415) {
				message = 'HTTP 415: Upload rejected (misplaced moov atom or unsupported codec)';
			} else if (res.status === 413) {
				message = 'HTTP 413: File exceeds 512 MiB API limit — use FFMPEG Toolkit Splitter';
			}
			throw new ApiError(res.status, message);
		}

		if (blob) return extractCaptureBlob(res);
		const ct = res.headers.get('content-type') || '';
		return ct.includes('application/json') ? res.json() : null;
	},

	get: (p, opts) => Api.call(p, { ...opts, method: 'GET' }),
	post: (p, body) => Api.call(p, { method: 'POST', body }),
	upload: (p, form) => Api.call(p, { method: 'POST', form }),
	put: (p, body) => Api.call(p, { method: 'PUT', body }),
	patch: p => Api.call(p, { method: 'PATCH' }),
	del: p => Api.call(p, { method: 'DELETE' }),

	wsUrl(path) {
		return Config.baseUrl.replace(/^http/, 'ws') + path;
	},
	openSocket(path) {
		return new WebSocket(Api.wsUrl(path), [`access_token.${Session.accessToken}`]);
	}
};

/* ── Session Management ──────────────────────────────────────────────────── */
const Session = {
	accessToken: null,
	refreshToken: null,
	expiresAt: null,
	refreshTimer: null,
	countdownTimer: null,

	get connected() {
		return !!this.accessToken;
	},

	async connect() {
		setConnection('connecting');
		const body = Config.apiKey ? { api_key: Config.apiKey } : {};
		const res = await fetch(Config.baseUrl + '/session', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			const j = await res.json().catch(() => null);
			setConnection('offline');
			throw new ApiError(res.status, (j && j.message) || (res.status === 429 ? 'Session limit reached' : `HTTP ${res.status}`));
		}
		const tokens = await res.json();
		this.accessToken = tokens.access_token;
		this.refreshToken = tokens.refresh_token;
		Config.wasConnected = true;

		const info = await Api.get('/session');
		this.expiresAt = new Date(info.expires_at).getTime();
		this.scheduleRefresh();
		this.startCountdown();
		setConnection('online');

		Telemetry.start();
		await hydrateState();
		Assets.refresh();
		Jobs.startAutoRefresh();
	},

	async refresh() {
		if (!this.refreshToken) return false;
		try {
			const res = await fetch(Config.baseUrl + '/session', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ refresh_token: this.refreshToken })
			});
			if (!res.ok) return false;
			const tokens = await res.json();
			this.accessToken = tokens.access_token;
			this.refreshToken = tokens.refresh_token;
			const info = await Api.get('/session');
			this.expiresAt = new Date(info.expires_at).getTime();
			this.scheduleRefresh();
			Telemetry.restart();
			return true;
		} catch {
			return false;
		}
	},

	scheduleRefresh() {
		clearTimeout(this.refreshTimer);
		const msLeft = this.expiresAt - Date.now();
		this.refreshTimer = setTimeout(() => this.refresh(), Math.max(msLeft * 0.55, 10_000));
	},

	startCountdown() {
		clearInterval(this.countdownTimer);
		const tick = () => {
			if (!dom.sessionTtl) return;
			const ms = this.expiresAt - Date.now();
			if (ms <= 0) {
				dom.sessionTtl.textContent = '00:00';
				return;
			}
			const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
			dom.sessionTtl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
		};
		tick();
		this.countdownTimer = setInterval(tick, 1000);
	},

	async disconnect() {
		Stream.stop();
		try { await Api.del('/session'); } catch { /* ignore */ }
		this.drop('Disconnected.');
	},

	drop(reason) {
		clearTimeout(this.refreshTimer);
		clearInterval(this.countdownTimer);
		this.accessToken = this.refreshToken = null;
		Telemetry.stop();
		Jobs.stopAutoRefresh();
		clearInterval(App.jobPoll);
		setConnection('offline');
		if (reason) toast(reason, 'info');
		checkReadiness();
	}
};

function setConnection(state) {
	if (!dom.connDot) return;
	const map = {
		online: ['dot-ok', 'connected'],
		connecting: ['dot-warn', 'connecting…'],
		offline: ['dot-idle', 'offline']
	};
	const [cls, label] = map[state];
	dom.connDot.className = 'dot ' + cls;
	dom.connLabel.textContent = label;
	if (dom.sessionTtl) dom.sessionTtl.hidden = state !== 'online';
	if (dom.btnDisconnect) dom.btnDisconnect.hidden = state !== 'online';
}

/* ── Telemetry (WS /metrics) ─────────────────────────────────────────────── */
const Telemetry = {
	ws: null,

	start() {
		this.stop();
		if (!dom.telemetry) return;
		try {
			this.ws = Api.openSocket('/metrics');
		} catch { return; }
		this.ws.onmessage = e => {
			try { this.render(JSON.parse(e.data)); } catch { /* ignore */ }
		};
		this.ws.onclose = () => {
			if (Session.connected) setTimeout(() => Session.connected && this.start(), 5000);
		};
		this.ws.onerror = () => this.ws.close();
	},

	restart() {
		if (Session.connected) this.start();
	},

	stop() {
		if (this.ws) {
			this.ws.onclose = null;
			try { this.ws.close(); } catch { /* ignore */ }
			this.ws = null;
		}
		if (dom.telemetry && dom.telemetryEmpty) {
			dom.telemetry.innerHTML = '';
			dom.telemetry.appendChild(dom.telemetryEmpty);
			dom.telemetryEmpty.hidden = false;
		}
	},

	render(m) {
		if (!dom.telemetry) return;
		const chips = [];
		const pct = v => v && typeof v.value === 'number' ? Math.round(v.value) : null;
		if (Array.isArray(m.graphic_devices)) {
			for (const g of m.graphic_devices) {
				const u = pct(g.utilization?.gpu ?? g.utilization);
				const mem = g.memory && g.memory.used && g.memory.total
					? `${g.memory.used.value}/${g.memory.total.value}${g.memory.total.unit || ''}`
					: '';
				const tempVal = g.temperature?.gpu?.value ?? g.temperature?.value;
				const temp = tempVal !== undefined ? ` ${Math.round(tempVal)}°C` : '';
				chips.push(this.chip('GPU', u !== null ? `<b>${u}%</b>` : '<b>—</b>', u, `${mem}${temp}`));
			}
		}
		if (m.processor) {
			const u = pct(m.processor.utilization);
			chips.push(this.chip('CPU', `<b>${u ?? '—'}%</b>`, u, ''));
		}
		if (m.memory && m.memory.utilization) {
			const u = pct(m.memory.utilization);
			const detail = m.memory.used && m.memory.total
				? `${m.memory.used.value}${m.memory.used.unit || ''}`
				: '';
			chips.push(this.chip('RAM', `<b>${u ?? '—'}%</b>`, u, detail));
		}
		dom.telemetry.innerHTML = chips.join('');
		if (dom.telemetryEmpty) dom.telemetryEmpty.hidden = true;
	},

	chip(label, valueHtml, pctValue, title) {
		const bar = pctValue !== null && pctValue !== undefined
			? `<span class="tbar"><i style="width:${Math.min(pctValue, 100)}%"></i></span>`
			: '';
		return `<span class="tchip" title="${title}">${label} ${valueHtml}${bar}</span>`;
	}
};

/* ── Capabilities & Pipeline Options ─────────────────────────────────────── */
const GROUP_ORDER = [
	'workflow', 'face_detector', 'face_aligner', 'face_selector', 'face_tracker',
	'face_masker', 'voice_extractor', 'frame_extraction', 'frame_distribution', 'output_creation'
];

const Options = {
	async load() {
		if (!dom.optionsGroups) return;
		App.caps = await Api.get('/capabilities');
		this.renderProcessors();
		this.renderGroups();
		dom.optionsPlaceholder && dom.optionsPlaceholder.remove();
	},

	activeProcessors() {
		return new Set(App.options.processors || []);
	},

	renderProcessors() {
		const meta = App.caps.arguments.processors && App.caps.arguments.processors.processors;
		if (!meta || !dom.processorChips) return;
		dom.processorChips.innerHTML = '';
		const selected = new Set(meta.default || []);
		App.options.processors = [...selected];

		for (const name of meta.choices) {
			const chip = document.createElement('button');
			chip.className = 'chip chip-proc' + (selected.has(name) ? ' is-on' : '');
			chip.dataset.processor = name;
			chip.setAttribute('aria-pressed', selected.has(name));
			chip.onclick = () => {
				const set = this.activeProcessors();
				set.has(name) ? set.delete(name) : set.add(name);
				const ordered = meta.choices.filter(c => set.has(c));
				this.markProcessorChips(ordered);
				this.highlightProcessorGroups();
				StateSync.push('processors', ordered);
				checkReadiness();
			};
			dom.processorChips.appendChild(chip);
		}
		this.markProcessorChips([...selected]);
	},

	markProcessorChips(ordered) {
		if (!dom.processorChips) return;
		for (const chip of dom.processorChips.children) {
			const name = chip.dataset.processor;
			const idx = ordered.indexOf(name);
			const ico = PROCESSOR_ICONS[name] || '';
			const cleanLabel = name.replace(/_/g, ' ');
			chip.classList.toggle('is-on', idx !== -1);
			chip.setAttribute('aria-pressed', idx !== -1);
			chip.innerHTML = idx !== -1
				? `<span class="chip-order">${idx + 1}</span>${ico}<span>${cleanLabel}</span>`
				: `${ico}<span>${cleanLabel}</span>`;
		}
	},

	groupNames() {
		const groups = Object.keys(App.caps.arguments);
		const processorOrder = (App.caps.arguments.processors?.processors?.choices) || [];
		return [
			...GROUP_ORDER.filter(g => groups.includes(g)),
			...processorOrder.filter(g => groups.includes(g)),
			...groups.filter(g => !GROUP_ORDER.includes(g) && !processorOrder.includes(g) && g !== 'processors')
		];
	},

	renderGroups() {
		if (!dom.optionsGroups) return;
		dom.optionsGroups.innerHTML = '';
		for (const group of this.groupNames()) {
			const args = App.caps.arguments[group];
			const details = document.createElement('details');
			details.className = 'ogroup';
			details.dataset.group = group;

			const summary = document.createElement('summary');
			const ico = PROCESSOR_ICONS[group] || '';
			summary.innerHTML = `<span class="ogroup-title">${ico}${group.replace(/_/g, ' ')}</span>`;
			details.appendChild(summary);

			const body = document.createElement('div');
			body.className = 'ogroup-body';
			for (const [key, meta] of Object.entries(args)) {
				body.appendChild(this.buildControl(key, meta));
			}
			details.appendChild(body);
			dom.optionsGroups.appendChild(details);
		}
		this.highlightProcessorGroups();
	},

	highlightProcessorGroups() {
		if (!dom.optionsGroups) return;
		const active = this.activeProcessors();
		for (const el of dom.optionsGroups.querySelectorAll('.ogroup')) {
			const on = active.has(el.dataset.group);
			el.classList.toggle('is-processor-active', on);
			if (on) el.open = true;
		}
	},

	buildControl(key, meta) {
		const wrap = document.createElement('div');
		wrap.className = 'opt';
		wrap.dataset.key = key;
		wrap.dataset.search = (key + ' ' + key.replace(/_/g, ' ')).toLowerCase();

		const label = document.createElement('div');
		label.className = 'opt-label';
		const labelText = document.createElement('span');
		labelText.textContent = key.replace(/_/g, ' ');
		const valueTag = document.createElement('span');
		valueTag.className = 'opt-value';
		label.append(labelText, valueTag);

		const d = meta.default, ch = meta.choices;
		let input, get, set;
		const asTyped = (sample, raw) => typeof sample === 'number' ? Number(raw) : raw;

		if (Array.isArray(d)) {
			if (ch && ch.length) {
				const sample = ch.find(c => c !== null);
				const current = new Set(d);
				const choiceEls = new Map();
				const toggle = (val, on) => {
					on ? current.add(val) : current.delete(val);
					const ordered = ch.filter(c => current.has(c));
					valueTag.textContent = `${ordered.length} selected`;
					StateSync.push(key, ordered);
				};
				if (ch.length <= 8) {
					input = document.createElement('div');
					input.className = 'chips';
					for (const c of ch) {
						const b = document.createElement('button');
						b.className = 'chip' + (current.has(c) ? ' is-on' : '');
						b.textContent = String(c);
						b.onclick = () => {
							const on = !b.classList.contains('is-on');
							b.classList.toggle('is-on', on);
							toggle(asTyped(sample, c), on);
						};
						choiceEls.set(c, b);
						input.appendChild(b);
					}
				} else {
					input = document.createElement('div');
					input.className = 'checklist';
					for (const c of ch) {
						const l = document.createElement('label');
						const cb = document.createElement('input');
						cb.type = 'checkbox';
						cb.checked = current.has(c);
						cb.onchange = () => toggle(asTyped(sample, c), cb.checked);
						l.append(cb, document.createTextNode(String(c)));
						choiceEls.set(c, cb);
						input.appendChild(l);
					}
				}
				valueTag.textContent = `${current.size} selected`;
				set = v => {
					const next = new Set(Array.isArray(v) ? v : []);
					current.clear();
					for (const val of next) current.add(val);
					for (const [c, el] of choiceEls) {
						const on = next.has(c);
						if (el.type === 'checkbox') el.checked = on;
						else el.classList.toggle('is-on', on);
					}
					valueTag.textContent = `${current.size} selected`;
				};
				get = () => ch.filter(c => current.has(c));
			} else {
				input = document.createElement('input');
				input.type = 'text';
				input.value = d.join(', ');
				input.spellcheck = false;
				set = v => { input.value = Array.isArray(v) ? v.join(', ') : ''; };
				get = () => input.value.split(',').map(s => s.trim()).filter(s => s !== '').map(s => isNaN(Number(s)) ? s : Number(s));
				input.onchange = () => StateSync.push(key, get());
			}
		} else if (typeof d === 'boolean') {
			const sw = document.createElement('label');
			sw.className = 'switch';
			input = document.createElement('input');
			input.type = 'checkbox';
			input.checked = d;
			const track = document.createElement('span');
			track.className = 'track';
			const txt = document.createElement('span');
			txt.className = 'switch-label';
			txt.textContent = key.replace(/_/g, ' ');
			sw.append(input, track, txt);
			input.onchange = () => StateSync.push(key, input.checked);
			wrap.appendChild(sw);
			wrap.dataset.search = (key + ' ' + txt.textContent).toLowerCase();
			set = v => { input.checked = !!v; };
			get = () => input.checked;
			App.controls.set(key, { set, get, el: wrap });
			return wrap;
		} else if (ch && ch.length) {
			const numeric = typeof ch.find(c => c !== null) === 'number';
			if (numeric && ch.length > 10 && d === null) {
				input = document.createElement('input');
				input.type = 'range';
				input.min = ch[0];
				input.max = ch[ch.length - 1];
				input.step = ch.length > 1 ? Math.abs(ch[1] - ch[0]) : 1;
				input.value = ch[0];
				input.disabled = true;
				let manual = false;
				valueTag.textContent = 'auto';

				const autoSw = document.createElement('label');
				autoSw.className = 'switch';
				const autoCb = document.createElement('input');
				autoCb.type = 'checkbox';
				autoCb.checked = false;
				const autoTrack = document.createElement('span');
				autoTrack.className = 'track';
				const autoTxt = document.createElement('span');
				autoTxt.className = 'switch-label';
				autoTxt.textContent = 'set manually';
				autoSw.append(autoCb, autoTrack, autoTxt);

				autoCb.onchange = () => {
					manual = autoCb.checked;
					input.disabled = !manual;
					valueTag.textContent = manual ? input.value : 'auto';
					if (manual) StateSync.push(key, Number(input.value));
				};
				input.oninput = () => { valueTag.textContent = input.value; };
				input.onchange = () => { if (manual) StateSync.push(key, Number(input.value)); };
				wrap.append(label, autoSw, input);
				set = v => {
					manual = v !== null && v !== undefined;
					autoCb.checked = manual;
					input.disabled = !manual;
					if (manual) input.value = v;
					valueTag.textContent = manual ? input.value : 'auto';
				};
				get = () => manual ? Number(input.value) : null;
				App.controls.set(key, { set, get, el: wrap });
				return wrap;
			}
			if (numeric && ch.length > 10) {
				input = document.createElement('input');
				input.type = 'range';
				input.min = ch[0];
				input.max = ch[ch.length - 1];
				input.step = ch.length > 1 ? Math.abs(ch[1] - ch[0]) : 1;
				input.value = d ?? ch[0];
				valueTag.textContent = input.value;
				input.oninput = () => { valueTag.textContent = input.value; };
				input.onchange = () => StateSync.push(key, Number(input.value));
				set = v => { input.value = v ?? ch[0]; valueTag.textContent = input.value; };
				get = () => Number(input.value);
			} else {
				input = document.createElement('select');
				if (d === null) {
					const auto = document.createElement('option');
					auto.value = '';
					auto.textContent = 'auto';
					input.appendChild(auto);
				}
				for (const c of ch) {
					const o = document.createElement('option');
					o.value = String(c);
					o.textContent = String(c);
					if (c === d) o.selected = true;
					input.appendChild(o);
				}
				const sample = ch.find(c => c !== null);
				input.onchange = () => {
					if (input.value === '') return;
					StateSync.push(key, asTyped(sample, input.value));
				};
				set = v => { input.value = v === null || v === undefined ? '' : String(v); };
				get = () => input.value === '' ? d : asTyped(sample, input.value);
			}
		} else if (typeof d === 'number') {
			input = document.createElement('input');
			input.type = 'number';
			input.step = 'any';
			input.value = d;
			input.onchange = () => StateSync.push(key, Number(input.value));
			set = v => { input.value = v; };
			get = () => Number(input.value);
		} else {
			input = document.createElement('input');
			input.type = 'text';
			input.spellcheck = false;
			if (d === null) input.placeholder = 'auto';
			else input.value = d;
			input.onchange = () => {
				const v = input.value.trim();
				if (v === '') return;
				const n = Number(v);
				StateSync.push(key, isNaN(n) ? v : n);
			};
			set = v => { input.value = v ?? ''; };
			get = () => input.value.trim() === '' ? d : input.value.trim();
		}

		wrap.append(label, input);
		App.controls.set(key, { set, get, el: wrap });
		return wrap;
	},

	filter(q) {
		if (!dom.optionsGroups) return;
		q = q.trim().toLowerCase();
		for (const group of dom.optionsGroups.querySelectorAll('.ogroup')) {
			let visible = 0;
			for (const opt of group.querySelectorAll('.opt')) {
				const show = !q || opt.dataset.search.includes(q);
				opt.hidden = !show;
				if (show) visible++;
			}
			group.hidden = visible === 0;
			if (q && visible > 0) group.open = true;
		}
	},

	payload() {
		const out = {};
		for (const [key, ctl] of App.controls) {
			const v = ctl.get();
			if (v !== undefined) out[key] = v;
		}
		out.processors = [...this.activeProcessors()];
		return out;
	}
};

/* ── State Sync (PUT /state) ─────────────────────────────────────────────── */
const StateSync = {
	timers: new Map(),

	push(key, value) {
		App.options[key] = value;
		clearTimeout(this.timers.get(key));
		this.timers.set(key, setTimeout(() => this.send(key, value), 350));
		this.setStatus('syncing…', 'is-syncing');
	},

	async send(key, value) {
		if (!Session.connected) return;
		try {
			await Api.put('/state', { [key]: value });
			App.lastGood[key] = value;
			this.setStatus('synced', 'is-ok');
		} catch (e) {
			this.setStatus('sync failed', 'is-err');
			toast(`Option "${key.replace(/_/g, ' ')}" rejected: ${e.message}`, 'error');
			const ctl = App.controls.get(key);
			if (ctl && key in App.lastGood) ctl.set(App.lastGood[key]);
		}
	},

	setStatus(text, cls) {
		if (!dom.syncState) return;
		dom.syncState.textContent = text;
		dom.syncState.className = 'sync-state ' + cls;
		clearTimeout(this._fade);
		this._fade = setTimeout(() => {
			dom.syncState.textContent = '';
			dom.syncState.className = 'sync-state';
		}, 2500);
	}
};

async function hydrateState() {
	try {
		const state = await Api.get('/state');
		for (const [key, ctl] of App.controls) {
			if (key in state) {
				ctl.set(state[key]);
				App.options[key] = state[key];
				App.lastGood[key] = state[key];
			}
		}
		if (Array.isArray(state.processors)) {
			Options.markProcessorChips(state.processors);
			Options.highlightProcessorGroups();
		}
	} catch (e) {
		toast('Could not read session state: ' + e.message, 'error');
	}
}

/* ── Assets & Automatic Faststart Upload Repair ──────────────────────────── */
const Assets = {
	async refresh() {
		if (!Session.connected) return;
		try {
			const res = await Api.get('/assets');
			App.assets = (res && res.assets) || [];
			this.renderZone('source');
			this.renderZone('target');
		} catch (e) {
			toast('Could not list assets: ' + e.message, 'error');
		}
	},

	ofType(type) {
		return App.assets.filter(a => a.type === type);
	},

	/**
	 * Uploads files to `/assets?type=source|target`.
	 * Automatically checks MP4/MOV/M4A files for end-of-file `moov` atoms and
	 * applies `-movflags +faststart` byte-reordering before uploading, AND
	 * retries with a forced faststart rebuild if the server returns 415.
	 */
	async upload(type, files) {
		if (!files || !files.length) return;
		if (!Session.connected) {
			toast('Connect to the FaceFusion API first.', 'error');
			if (dom.settingsModal) dom.settingsModal.hidden = false;
			return;
		}

		// Check 512 MiB API limit upfront
		const oversized = files.find(f => f.size > 512 * 1024 * 1024);
		if (oversized) {
			toast(`"${oversized.name}" (${formatBytes(oversized.size)}) exceeds the 512 MiB API limit. Opening FFMPEG Toolkit Splitter…`, 'warn', 6000);
			switchTab('toolkit');
			Toolkit.loadSplitterFile(oversized);
			return;
		}

		const loading = type === 'source' ? dom.sourceLoading : dom.targetLoading;
		const loadingTextNode = loading ? loading.childNodes[loading.childNodes.length - 1] : null;
		const setLoadText = txt => {
			if (loadingTextNode && loadingTextNode.nodeType === Node.TEXT_NODE) {
				loadingTextNode.textContent = txt;
			}
		};

		if (loading) loading.hidden = false;

		try {
			const preparedFiles = [];
			for (const rawFile of files) {
				if (Mp4Toolkit.isMp4Family(rawFile) && Config.autoFaststart) {
					setLoadText('Checking moov atom…');
					const check = await Mp4Toolkit.ensureFaststartForUpload(rawFile);
					if (check.repaired) {
						toast(`Auto-fixed moov atom (faststart): ${check.fixedName}`, 'ok', 5000);
					}
					preparedFiles.push(check.file);
				} else {
					preparedFiles.push(rawFile);
				}
			}

			setLoadText('Uploading…');
			const form = new FormData();
			for (const f of preparedFiles) form.append('file', f);

			let res;
			try {
				res = await Api.upload(`/assets?type=${type}`, form);
			} catch (err) {
				// Fallback: if upload failed with 415 and we haven't forced a faststart pass yet
				if (err.status === 415 && files.some(f => Mp4Toolkit.isMp4Family(f))) {
					setLoadText('Repairing MP4 moov atom (faststart)…');
					toast('Upload rejected (415) — running automatic faststart moov repair…', 'warn');
					const retryForm = new FormData();
					for (const orig of files) {
						if (Mp4Toolkit.isMp4Family(orig)) {
							const fixed = await Mp4Toolkit.toFaststart(orig, true);
							if (Config.autoSaveFixed) triggerDownload(fixed.file, fixed.fixedName);
							retryForm.append('file', fixed.file);
						} else {
							retryForm.append('file', orig);
						}
					}
					setLoadText('Re-uploading fixed MP4…');
					res = await Api.upload(`/assets?type=${type}`, retryForm);
					toast('Repaired MP4 uploaded!', 'ok');
				} else {
					throw err;
				}
			}

			const ids = (res && res.asset_ids) || [];
			if (!ids.length) throw new Error('Upload was rejected (unsupported or unsafe file).');

			await this.refresh();
			if (type === 'source') {
				for (const id of ids) App.selectedSources.add(id);
				await this.selectSources();
			} else {
				await this.selectTarget(ids[ids.length - 1]);
			}
			toast(`${ids.length} ${type} asset${ids.length > 1 ? 's' : ''} ready`, 'ok');
		} catch (e) {
			toast(`Upload failed: ${e.message}`, 'error');
		} finally {
			setLoadText('Uploading…');
			if (loading) loading.hidden = true;
			checkReadiness();
		}
	},

	async selectSources() {
		const ids = [...App.selectedSources].filter(id => App.assets.some(a => a.id === id));
		App.selectedSources = new Set(ids);
		try {
			await Api.put('/state?action=select&type=source', { asset_ids: ids });
		} catch (e) {
			toast('Source selection failed: ' + e.message, 'error');
		}
	},

	async selectTarget(id) {
		App.selectedTarget = id;
		try {
			await Api.put('/state?action=select&type=target', { asset_id: id });
		} catch (e) {
			toast('Target selection failed: ' + e.message, 'error');
		}
		checkReadiness();
	},

	async remove(asset) {
		try {
			await Api.del('/assets/' + asset.id);
			App.selectedSources.delete(asset.id);
			if (App.selectedTarget === asset.id) App.selectedTarget = null;
			await this.refresh();
			if (asset.type === 'source') await this.selectSources();
			checkReadiness();
		} catch (e) {
			toast('Delete failed: ' + e.message, 'error');
		}
	},

	renderZone(type) {
		const thumbsEl = type === 'source' ? dom.sourceThumbs : dom.targetThumbs;
		const emptyEl = type === 'source' ? dom.sourceEmpty : dom.targetEmpty;
		const zone = type === 'source' ? dom.zoneSource : dom.zoneTarget;
		const facesBtn = type === 'source' ? dom.btnSourceFaces : dom.btnTargetFaces;
		if (!thumbsEl || !emptyEl || !zone) return;

		const assets = this.ofType(type);
		thumbsEl.innerHTML = '';
		emptyEl.style.display = assets.length ? 'none' : '';
		zone.classList.toggle('has-assets', assets.length > 0);

		const facesAsset = type === 'source'
			? assets.find(a => App.selectedSources.has(a.id) && a.media !== 'audio')
			: assets.find(a => a.id === App.selectedTarget);
		if (facesBtn) {
			facesBtn.hidden = !facesAsset;
			facesBtn.onclick = () => this.showFaces(facesAsset);
		}

		for (const asset of assets) {
			const thumb = document.createElement('div');
			thumb.className = 'thumb';
			const selected = type === 'source' ? App.selectedSources.has(asset.id) : App.selectedTarget === asset.id;
			thumb.classList.toggle('is-selected', selected);
			if (type === 'source' && !selected) thumb.classList.add('is-deselected');
			thumb.title = `${asset.name}.${asset.format} (${asset.media})`;

			const badge = document.createElement('span');
			badge.className = 'thumb-badge';
			badge.textContent = `${asset.media} · ${asset.format}`;

			if (asset.media === 'audio') {
				const icon = document.createElement('div');
				icon.style.cssText = 'display:flex;height:100%;align-items:center;justify-content:center;color:var(--accent);font-size:22px;';
				icon.textContent = '♫';
				thumb.appendChild(icon);
			} else {
				const img = document.createElement('img');
				img.alt = asset.name;
				thumb.appendChild(img);
				this.captureUrl(asset, 'frame', '160x160').then(url => {
					if (url) img.src = url;
				});
			}

			const x = document.createElement('button');
			x.className = 'thumb-x';
			x.textContent = '✕';
			x.title = 'Delete asset';
			x.setAttribute('aria-label', 'Delete asset ' + asset.name);
			x.onclick = e => {
				e.stopPropagation();
				this.remove(asset);
			};

			thumb.append(badge, x);
			thumb.onclick = () => {
				if (type === 'source') {
					App.selectedSources.has(asset.id)
						? App.selectedSources.delete(asset.id)
						: App.selectedSources.add(asset.id);
					this.selectSources().then(() => {
						this.renderZone('source');
						checkReadiness();
					});
				} else {
					this.selectTarget(asset.id).then(() => this.renderZone('target'));
				}
			};
			thumbsEl.appendChild(thumb);
		}
	},

	async captureUrl(asset, subject, resolution) {
		try {
			let path = `/assets/${asset.id}?action=capture&subject=${subject}&resolution=${resolution}`;
			if (asset.media === 'video') path += '&frame_index=0';
			const blob = await Api.get(path, { blob: true });
			const url = URL.createObjectURL(blob);
			App.blobUrls.add(url);
			return url;
		} catch {
			return null;
		}
	},

	async showFaces(asset) {
		if (!asset || !dom.facesModal) return;
		dom.facesModal.hidden = false;
		dom.facesLoading.hidden = false;
		dom.facesImage.hidden = true;
		const titleEl = $('facesTitle');
		if (titleEl) titleEl.textContent = `Detected faces — ${asset.name}.${asset.format}`;
		const url = await this.captureUrl(asset, 'face', '1024x1024');
		dom.facesLoading.hidden = true;
		if (url) {
			dom.facesImage.src = url;
			dom.facesImage.hidden = false;
		} else {
			toast('No faces detected in this asset.', 'info');
			dom.facesModal.hidden = true;
		}
	},

	outputForJob(jobId) {
		return App.assets
			.filter(a => a.type === 'output' && (a.name === jobId || a.name.startsWith(jobId)))
			.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
	}
};

/* ── Jobs Pipeline ───────────────────────────────────────────────────────── */
const Jobs = {
	async runPipeline() {
		if (App.busy) return;
		App.busy = true;
		if (dom.btnRun) dom.btnRun.disabled = true;
		Output.showProgress('Creating job', '');
		try {
			const job = await Api.post('/jobs');
			const jobId = job.job_id;
			Output.showProgress('Adding step', Options.activeProcessors().size + ' processor(s)');
			await Api.post(`/jobs/${jobId}?action=add`, Options.payload());
			Output.showProgress('Submitting job', jobId);
			await Api.patch(`/jobs/${jobId}?action=submit`);
			Output.showProgress('Running neural pipeline', jobId);
			await Api.patch(`/jobs/${jobId}?action=run`);
			await this.poll(jobId);
			Output.showProgress('Collecting output', jobId);
			const asset = await this.waitForOutput(jobId);
			Output.hideProgress();
			if (asset) {
				await Output.display(asset);
				toast('Job completed', 'ok');
			} else {
				toast('Job completed but no output asset was found.', 'error');
			}
		} catch (e) {
			Output.hideProgress();
			toast(e.status === 409 ? 'Another job is already queued or running.' : `Job failed: ${e.message}`, 'error');
		} finally {
			App.busy = false;
			checkReadiness();
			this.refresh();
		}
	},

	poll(jobId) {
		return new Promise((resolve, reject) => {
			clearInterval(App.jobPoll);
			App.jobPoll = setInterval(async () => {
				try {
					const job = await Api.get('/jobs/' + jobId);
					const steps = job.steps || [];
					const done = steps.filter(s => s.status === 'completed').length;
					const failed = steps.find(s => s.status === 'failed');
					const running = steps.find(s => s.status === 'started');
					Output.showProgress(
						failed ? 'Failed' : 'Processing',
						`${done}/${steps.length} steps done${running ? ' · ' + (running.args.processors || []).join(', ') : ''}`
					);
					if (failed) {
						clearInterval(App.jobPoll);
						reject(new Error(`Step failed: ${(failed.args.processors || []).join(', ')}`));
					} else if (steps.length && done === steps.length) {
						clearInterval(App.jobPoll);
						resolve();
					}
				} catch (e) {
					clearInterval(App.jobPoll);
					reject(e);
				}
			}, 1500);
		});
	},

	async waitForOutput(jobId, tries = 8) {
		for (let i = 0; i < tries; i++) {
			await Assets.refresh();
			const asset = Assets.outputForJob(jobId);
			if (asset) return asset;
			await new Promise(r => setTimeout(r, 1000));
		}
		return null;
	},

	async refresh() {
		if (!Session.connected || !dom.jobsList) return;
		const statuses = ['queued', 'drafted', 'failed', 'completed'];
		const sections = [];
		try {
			for (const status of statuses) {
				const res = await Api.get(`/jobs?status=${status}`);
				const jobs = Object.entries(res || {}).map(([id, meta]) => ({ id, status, ...meta }));
				if (jobs.length) sections.push({ status, jobs });
			}
		} catch { return; }
		this.render(sections);
	},

	render(sections) {
		if (!dom.jobsList) return;
		dom.jobsList.innerHTML = '';
		if (!sections.length) {
			if (dom.jobsEmpty) {
				dom.jobsList.appendChild(dom.jobsEmpty);
				dom.jobsEmpty.hidden = false;
			}
			return;
		}
		for (const { status, jobs } of sections) {
			const label = document.createElement('div');
			label.className = 'jobs-section-label';
			label.textContent = status.toUpperCase();
			dom.jobsList.appendChild(label);
			jobs.sort((a, b) => (b.date_created || '').localeCompare(a.date_created || ''));
			for (const job of jobs.slice(0, 25)) {
				dom.jobsList.appendChild(this.renderJob(job));
			}
		}
	},

	renderJob(job) {
		const el = document.createElement('div');
		el.className = 'job';
		const top = document.createElement('div');
		top.className = 'job-top';
		const id = document.createElement('span');
		id.className = 'job-id';
		id.textContent = job.id;
		id.title = job.id;
		const chip = document.createElement('span');
		chip.className = 'job-status ' + job.status;
		chip.textContent = job.status;
		top.append(id, chip);
		el.appendChild(top);

		if (job.date_created) {
			const steps = document.createElement('div');
			steps.className = 'job-steps';
			const line = document.createElement('div');
			line.className = 'job-step';
			line.textContent = new Date(job.date_created).toLocaleString();
			steps.appendChild(line);
			el.appendChild(steps);
		}

		const actions = document.createElement('div');
		actions.className = 'job-actions';
		const mk = (text, fn, cls = '') => {
			const b = document.createElement('button');
			b.className = 'btn btn-mini ' + cls;
			b.textContent = text;
			b.onclick = fn;
			actions.appendChild(b);
		};
		if (job.status === 'drafted') mk('Submit', () => this.act(`/jobs/${job.id}?action=submit`));
		if (job.status === 'queued') mk('Run', () => this.act(`/jobs/${job.id}?action=run`));
		if (job.status === 'failed') mk('Retry', () => this.act(`/jobs/${job.id}?action=retry`));
		if (job.status === 'completed') {
			mk('Show output', async () => {
				await Assets.refresh();
				const asset = Assets.outputForJob(job.id);
				asset ? Output.display(asset) : toast('No output asset found for this job.', 'error');
			});
		}
		mk('Delete', async () => {
			try {
				await Api.del('/jobs/' + job.id);
				this.refresh();
			} catch (e) {
				toast('Delete failed: ' + e.message, 'error');
			}
		}, 'btn-danger');
		el.appendChild(actions);
		return el;
	},

	async act(path) {
		try {
			await Api.patch(path);
			this.refresh();
		} catch (e) {
			toast(e.status === 409 ? 'Another job is already queued or running.' : 'Action failed: ' + e.message, 'error');
		}
	},

	startAutoRefresh() {
		this.refresh();
		this.stopAutoRefresh();
		App.jobsTimer = setInterval(() => this.refresh(), 5000);
	},

	stopAutoRefresh() {
		clearInterval(App.jobsTimer);
	}
};

/* ── Output Stage ────────────────────────────────────────────────────────── */
const Output = {
	current: null,

	showProgress(phase, detail) {
		if (!dom.outputProgress) return;
		dom.outputProgress.hidden = false;
		dom.jobPhase.textContent = phase;
		dom.jobDetail.textContent = detail || '';
	},

	hideProgress() {
		if (dom.outputProgress) dom.outputProgress.hidden = true;
	},

	async display(asset) {
		this.current = asset;
		try {
			const blob = await Api.get(`/assets/${asset.id}?action=download`, { blob: true });
			const url = URL.createObjectURL(blob);
			App.blobUrls.add(url);

			dom.outputEmpty.style.display = 'none';
			dom.btnDownload.hidden = false;
			dom.btnDownload.href = url;
			dom.btnDownload.download = `${asset.name}.${asset.format}`;

			if (asset.media === 'video') {
				dom.outputImage.hidden = true;
				dom.compareWrap.hidden = true;
				dom.outputVideo.src = url;
				dom.outputVideo.hidden = false;
				dom.viewSwitch.hidden = true;
			} else {
				dom.outputVideo.hidden = true;
				dom.outputImage.src = url;
				dom.outputImage.hidden = false;
				this.setupCompare(asset, url);
			}
		} catch (e) {
			toast('Could not download output: ' + e.message, 'error');
		}
	},

	async setupCompare(asset, resultUrl) {
		const target = App.assets.find(a => a.id === App.selectedTarget);
		if (!target || target.media !== 'image') {
			dom.viewSwitch.hidden = true;
			return;
		}
		const baseUrl = await Assets.captureUrl(target, 'frame', '1024x1024');
		if (!baseUrl) {
			dom.viewSwitch.hidden = true;
			return;
		}
		dom.viewSwitch.hidden = false;
		dom.compareBase.src = baseUrl;
		dom.compareTop.src = resultUrl;
		this.setView('result');
	},

	setView(view) {
		const comparing = view === 'compare' && !dom.viewSwitch.hidden;
		dom.viewResult.classList.toggle('is-active', !comparing);
		dom.viewCompare.classList.toggle('is-active', comparing);
		dom.compareWrap.hidden = !comparing;
		dom.outputImage.hidden = comparing || !dom.outputImage.src;
		if (comparing) requestAnimationFrame(() => this.syncCompare());
	},

	syncCompare() {
		const w = dom.compareWrap.clientWidth;
		if (!w) return;
		dom.compareBase.style.width = w + 'px';
		dom.compareTop.style.width = w + 'px';
		dom.compareTopWrap.style.width = dom.compareSlider.value + '%';
	}
};

/* ── Live Stream (WS /stream) ────────────────────────────────────────────── */
const Stream = {
	ws: null,
	media: null,
	timer: null,
	frames: 0,
	fpsTimer: null,
	lastUrl: null,
	canvas: document.createElement('canvas'),

	async startWebcam() {
		if (!Session.connected) return toast('Connect to the API first.', 'error');
		try {
			this.media = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 960 } }, audio: false });
		} catch {
			return toast('Webcam not available.', 'error');
		}
		dom.streamInput.srcObject = this.media;
		dom.streamInput.play();
		dom.streamInputEmpty.style.display = 'none';
		this.connect(() => {
			this.timer = setInterval(() => this.sendFrame(), 125);
		});
		this.ui(true);
	},

	async sendImage(file) {
		if (!Session.connected) return toast('Connect to the API first.', 'error');
		const bitmap = await createImageBitmap(file);
		this.canvas.width = bitmap.width;
		this.canvas.height = bitmap.height;
		this.canvas.getContext('2d').drawImage(bitmap, 0, 0);

		dom.streamInputEmpty.style.display = 'none';
		const still = document.createElement('img');
		still.className = 'stream-media';
		still.src = URL.createObjectURL(file);
		App.blobUrls.add(still.src);
		dom.streamInput.replaceWith(still);
		dom.streamInput = still;

		this.connect(() => {
			this.canvas.toBlob(b => b && this.ws.readyState === WebSocket.OPEN && this.ws.send(b), 'image/jpeg', 0.85);
		});
	},

	connect(onOpen) {
		this.closeSocket();
		this.ws = Api.openSocket('/stream');
		this.ws.binaryType = 'blob';
		this.ws.onopen = () => {
			onOpen();
			this.frames = 0;
			this.fpsTimer = setInterval(() => {
				dom.streamFps.textContent = this.frames ? `${this.frames} fps` : '';
				this.frames = 0;
			}, 1000);
		};
		this.ws.onmessage = async e => {
			const blob = e.data instanceof Blob ? e.data : new Blob([e.data]);
			const url = URL.createObjectURL(blob);
			if (this.lastUrl) {
				URL.revokeObjectURL(this.lastUrl);
				App.blobUrls.delete(this.lastUrl);
			}
			this.lastUrl = url;
			dom.streamOutput.src = url;
			dom.streamOutput.hidden = false;
			dom.streamOutputEmpty.style.display = 'none';
			this.frames++;
		};
		this.ws.onerror = () => toast('Stream socket error.', 'error');
		this.ws.onclose = () => this.ui(false);
	},

	sendFrame() {
		const v = dom.streamInput;
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !v.videoWidth) return;
		if (this.ws.bufferedAmount > 512 * 1024) return;
		const scale = Math.min(1, 640 / v.videoWidth);
		this.canvas.width = Math.round(v.videoWidth * scale);
		this.canvas.height = Math.round(v.videoHeight * scale);
		this.canvas.getContext('2d').drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
		this.canvas.toBlob(b => {
			if (b && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(b);
		}, 'image/jpeg', 0.7);
	},

	ui(active) {
		if (!dom.btnStreamStart) return;
		dom.btnStreamStart.hidden = active;
		dom.btnStreamImage.hidden = active;
		dom.btnStreamStop.hidden = !active;
		if (!active) dom.streamFps.textContent = '';
	},

	closeSocket() {
		if (this.ws) {
			this.ws.onclose = null;
			try { this.ws.close(); } catch { /* ignore */ }
			this.ws = null;
		}
		clearInterval(this.fpsTimer);
	},

	stop() {
		clearInterval(this.timer);
		this.timer = null;
		this.closeSocket();
		if (this.media) {
			this.media.getTracks().forEach(t => t.stop());
			this.media = null;
		}
		if (!dom.streamInput) return;
		if (dom.streamInput.tagName === 'VIDEO') {
			dom.streamInput.srcObject = null;
		} else {
			const video = document.createElement('video');
			video.id = 'streamInput';
			video.className = 'stream-media';
			video.muted = true;
			video.playsInline = true;
			dom.streamInput.replaceWith(video);
			dom.streamInput = video;
		}
		dom.streamInputEmpty.style.display = '';
		dom.streamOutput.hidden = true;
		dom.streamOutputEmpty.style.display = '';
		this.ui(false);
	}
};

/* ==========================================================================
   FFMPEG TOOLKIT UI CONTROLLER (Faststart Batch Repair + <500 MB Splitter)
   ========================================================================== */
const Toolkit = {
	async addFaststartFiles(files) {
		if (!files || !files.length) return;
		for (const file of files) {
			const item = {
				id: Math.random().toString(36).slice(2),
				file,
				status: 'inspecting',
				needsFix: false,
				duration: null,
				fixedFile: null,
				fixedName: file.name.replace(/(\.[^.]+)$/, '_f$1'),
				error: null
			};
			App.faststartQueue.push(item);
			this.renderFaststartList();

			try {
				const info = await Mp4Toolkit.inspect(file);
				item.duration = info.duration;
				if (!info.valid) {
					item.status = 'error';
					item.error = info.reason;
				} else {
					item.needsFix = info.needsFaststart;
					// Immediately run faststart repair
					item.status = 'repairing';
					this.renderFaststartList();
					const res = await Mp4Toolkit.toFaststart(file, true);
					item.fixedFile = res.file;
					item.fixedName = res.fixedName;
					item.status = res.changed ? 'repaired' : 'already_ok';
				}
			} catch (err) {
				item.status = 'error';
				item.error = err.message;
			}
			this.renderFaststartList();
		}
	},

	renderFaststartList() {
		if (!dom.faststartList) return;
		if (!App.faststartQueue.length) {
			dom.faststartList.innerHTML = `<div class="tk-empty">No videos queued yet. Drop .mp4 / .mov files above to relocate the <code>moov</code> atom to the front.</div>`;
			if (dom.btnFaststartDownloadAll) dom.btnFaststartDownloadAll.disabled = true;
			return;
		}

		const hasFixed = App.faststartQueue.some(x => x.fixedFile);
		if (dom.btnFaststartDownloadAll) dom.btnFaststartDownloadAll.disabled = !hasFixed;

		dom.faststartList.innerHTML = '';
		for (const item of App.faststartQueue) {
			const row = document.createElement('div');
			row.className = 'tk-item';

			let badgeClass = 'tk-badge';
			let badgeText = item.status;
			if (item.status === 'repaired') {
				badgeClass += ' is-ok';
				badgeText = 'MOOV MOVED TO FRONT (_f.mp4)';
			} else if (item.status === 'already_ok') {
				badgeClass += ' is-info';
				badgeText = 'ALREADY FASTSTART (_f.mp4 READY)';
			} else if (item.status === 'error') {
				badgeClass += ' is-err';
				badgeText = item.error || 'ERROR';
			} else {
				badgeClass += ' is-warn';
				badgeText = 'PROCESSING…';
			}

			const info = document.createElement('div');
			info.className = 'tk-item-info';
			info.innerHTML = `
				<div class="tk-item-name mono">${item.fixedFile ? item.fixedName : item.file.name}</div>
				<div class="tk-item-meta">
					<span>${formatBytes(item.file.size)}</span>
					${item.duration ? `<span>· ${formatDuration(item.duration)}</span>` : ''}
					<span class="${badgeClass}">${badgeText}</span>
				</div>
			`;

			const actions = document.createElement('div');
			actions.className = 'tk-item-actions';

			if (item.fixedFile) {
				const btnDl = document.createElement('button');
				btnDl.className = 'btn btn-mini btn-primary';
				btnDl.textContent = 'Download _f.mp4';
				btnDl.onclick = () => triggerDownload(item.fixedFile, item.fixedName);
				actions.appendChild(btnDl);

				if (dom.tabBatch) {
					const btnTarget = document.createElement('button');
					btnTarget.className = 'btn btn-mini';
					btnTarget.textContent = 'Use as Target';
					btnTarget.onclick = async () => {
						switchTab('batch');
						await Assets.upload('target', [item.fixedFile]);
					};
					actions.appendChild(btnTarget);
				}
			}

			row.append(info, actions);
			dom.faststartList.appendChild(row);
		}
	},

	downloadAllFaststart() {
		for (const item of App.faststartQueue) {
			if (item.fixedFile) triggerDownload(item.fixedFile, item.fixedName);
		}
	},

	clearFaststart() {
		App.faststartQueue = [];
		this.renderFaststartList();
	},

	loadSplitterFile(file) {
		if (!file) return;
		App.splitSourceFile = file;
		App.splitQueue = [];
		if (dom.btnSplitRun) {
			dom.btnSplitRun.disabled = false;
			dom.btnSplitRun.textContent = `Split "${file.name}" (${formatBytes(file.size)})`;
		}
		this.updateCliPreview();
		this.renderSplitterList();
	},

	updateCliPreview() {
		if (!dom.ffmpegCmdBox) return;
		const fName = App.splitSourceFile ? App.splitSourceFile.name : 'input.mp4';
		const stem = fName.replace(/\.[^.]+$/, '');
		const mode = dom.splitMode ? dom.splitMode.value : 'size';
		const val = Number(dom.splitValue ? dom.splitValue.value : 450) || 450;

		if (mode === 'duration') {
			dom.ffmpegCmdBox.value = `ffmpeg -i "${fName}" -c copy -map 0 -f segment -segment_time ${val} -reset_timestamps 1 -movflags +faststart "${stem}_part%02d_f.mp4"`;
		} else {
			dom.ffmpegCmdBox.value = `for %I in (*.mp4) do ffmpeg -i "%I" -movflags faststart -c copy "%~nI_f.mp4"`;
		}
	},

	async runSplitter() {
		const file = App.splitSourceFile;
		if (!file) return toast('Drop or select an MP4 video to split first.', 'error');

		const mode = dom.splitMode ? dom.splitMode.value : 'size';
		const rawVal = Number(dom.splitValue ? dom.splitValue.value : 450) || 450;

		if (dom.btnSplitRun) {
			dom.btnSplitRun.disabled = true;
			dom.btnSplitRun.textContent = 'Splitting video on keyframes…';
		}

		try {
			const parts = await Mp4Toolkit.splitMp4(file, {
				mode: mode === 'duration' ? 'duration' : 'size',
				maxBytes: Math.max(10, rawVal) * 1024 * 1024,
				segmentSeconds: Math.max(5, rawVal)
			});
			App.splitQueue = parts;
			toast(`Created ${parts.length} faststart segment${parts.length > 1 ? 's' : ''}!`, 'ok');
		} catch (err) {
			toast(`In-browser split failed (${err.message}). Use the terminal command below for this codec.`, 'error', 6500);
		} finally {
			if (dom.btnSplitRun) {
				dom.btnSplitRun.disabled = false;
				dom.btnSplitRun.textContent = `Split "${file.name}" (${formatBytes(file.size)})`;
			}
			this.renderSplitterList();
		}
	},

	renderSplitterList() {
		if (!dom.splitterList) return;
		if (!App.splitQueue.length) {
			const msg = App.splitSourceFile
				? `Ready to split <b>${App.splitSourceFile.name}</b> (${formatBytes(App.splitSourceFile.size)}). Click <b>Split</b> above.`
				: `Drop a large video (>500 MB) above to slice it into API-ready segments with <code>moov</code> at the front.`;
			dom.splitterList.innerHTML = `<div class="tk-empty">${msg}</div>`;
			return;
		}

		dom.splitterList.innerHTML = '';
		for (const seg of App.splitQueue) {
			const row = document.createElement('div');
			row.className = 'tk-item';

			const underLimit = seg.size <= 512 * 1024 * 1024;
			const info = document.createElement('div');
			info.className = 'tk-item-info';
			info.innerHTML = `
				<div class="tk-item-name mono">${seg.name}</div>
				<div class="tk-item-meta">
					<span>${formatBytes(seg.size)}</span>
					<span>· ${formatDuration(seg.startTime)} → ${formatDuration(seg.endTime)} (${formatDuration(seg.duration)})</span>
					<span class="tk-badge ${underLimit ? 'is-ok' : 'is-warn'}">${underLimit ? 'API READY (<512 MB)' : '>512 MB'}</span>
				</div>
			`;

			const actions = document.createElement('div');
			actions.className = 'tk-item-actions';

			const btnDl = document.createElement('button');
			btnDl.className = 'btn btn-mini btn-primary';
			btnDl.textContent = 'Download';
			btnDl.onclick = () => triggerDownload(seg.file, seg.name);
			actions.appendChild(btnDl);

			if (dom.tabBatch) {
				const btnTarget = document.createElement('button');
				btnTarget.className = 'btn btn-mini';
				btnTarget.textContent = 'Use as Target';
				btnTarget.onclick = async () => {
					switchTab('batch');
					await Assets.upload('target', [seg.file]);
				};
				actions.appendChild(btnTarget);
			}

			row.append(info, actions);
			dom.splitterList.appendChild(row);
		}
	}
};

/* ── Readiness Check ─────────────────────────────────────────────────────── */
function checkReadiness() {
	if (App.busy || !dom.btnRun) return;
	const processors = App.options.processors || [];
	let ok = Session.connected && App.selectedTarget && processors.length > 0;
	let hint = '';

	if (!Session.connected) hint = 'Connect to the API first.';
	else if (!processors.length) hint = 'Select at least one processor.';
	else if (!App.selectedTarget) hint = 'Add a target image or video.';
	else {
		for (const [proc, kind] of Object.entries(SOURCE_RULES)) {
			if (processors.includes(proc)) {
				const has = [...App.selectedSources].some(id => {
					const a = App.assets.find(x => x.id === id);
					return a && (kind === 'image' ? a.media === 'image' : a.media === 'audio');
				});
				if (!has) {
					ok = false;
					hint = `${proc.replace(/_/g, ' ')} needs ${kind === 'image' ? 'an image' : 'an audio'} source.`;
				}
			}
		}
	}
	dom.btnRun.disabled = !ok;
	if (dom.runHint) dom.runHint.textContent = ok ? processors.join(' → ') : hint;
}

/* ── Navigation & Self-Bootstrapping UI ──────────────────────────────────── */
function switchTab(name) {
	const tabs = [
		['batch', dom.tabBtnBatch, dom.tabBatch],
		['stream', dom.tabBtnStream, dom.tabStream],
		['toolkit', dom.tabBtnToolkit, dom.tabToolkit]
	];
	for (const [id, btn, panel] of tabs) {
		const active = id === name;
		if (btn) {
			btn.classList.toggle('is-active', active);
			btn.setAttribute('aria-selected', active);
		}
		if (panel) panel.hidden = !active;
	}
	if (name === 'stream') Jobs.refresh();
}

/**
 * Dynamically injects the AI/Faceswap visual polish and FFMPEG Toolkit UI
 * if the user opens an older `index.html` or `styles.css` that lacks them.
 */
function ensureModernUiAndToolkit() {
	if (!$('ffNeuralStyles')) {
		const style = document.createElement('style');
		style.id = 'ffNeuralStyles';
		style.textContent = `
			:root {
				--accent-cyan: #00f0ff;
				--accent-glow: rgba(255, 107, 44, 0.35);
				--cyan-dim: rgba(0, 240, 255, 0.11);
			}
			.topbar {
				background: linear-gradient(180deg, #191920 0%, #121216 100%);
				box-shadow: 0 4px 20px rgba(0, 0, 0, .45);
			}
			.brand-mark {
				filter: drop-shadow(0 0 8px rgba(255, 107, 44, .55));
			}
			.chip-proc, .ogroup-title {
				display: inline-flex;
				align-items: center;
				gap: 6px;
			}
			.p-ico {
				width: 14px;
				height: 14px;
				flex: none;
				opacity: .85;
			}
			.chip.is-on {
				box-shadow: 0 0 12px rgba(255, 107, 44, .22), inset 0 0 6px rgba(255, 107, 44, .12);
			}
			.btn-run:not(:disabled) {
				background: linear-gradient(135deg, #ff6b2c 0%, #ff3d71 100%);
				border-color: #ff8046;
				color: #fff;
				box-shadow: 0 0 18px rgba(255, 107, 44, .45);
				transition: transform .12s, box-shadow .2s;
			}
			.btn-run:not(:disabled):hover {
				box-shadow: 0 0 26px rgba(255, 107, 44, .75), 0 0 12px rgba(0, 240, 255, .35);
				transform: translateY(-1px);
			}
			.thumb.is-selected::after {
				content: "";
				position: absolute;
				inset: 0;
				background: linear-gradient(180deg, transparent 0%, rgba(0, 240, 255, .16) 50%, transparent 100%);
				background-size: 100% 200%;
				animation: ffScanline 2.6s linear infinite;
				pointer-events: none;
			}
			@keyframes ffScanline {
				0% { background-position: 0 -100%; }
				100% { background-position: 0 200%; }
			}
			/* FFMPEG Toolkit Styles */
			#tabToolkit {
				display: flex;
				flex-direction: column;
				gap: 14px;
				flex: 1;
				min-height: 0;
				overflow-y: auto;
			}
			#tabToolkit[hidden] { display: none; }
			.tk-grid {
				display: grid;
				grid-template-columns: 1fr 1fr;
				gap: 14px;
			}
			@media (max-width: 980px) {
				.tk-grid { grid-template-columns: 1fr; }
			}
			.tk-card {
				background: var(--bg-1);
				border: 1px solid var(--line);
				border-radius: var(--radius);
				padding: 14px;
				display: flex;
				flex-direction: column;
				gap: 12px;
			}
			.tk-card-head {
				display: flex;
				justify-content: space-between;
				align-items: flex-start;
				gap: 10px;
				border-bottom: 1px solid var(--line-soft);
				padding-bottom: 10px;
			}
			.tk-card-title {
				font-size: 14px;
				font-weight: 650;
				color: var(--text-1);
				display: flex;
				align-items: center;
				gap: 8px;
			}
			.tk-card-sub {
				font-size: 12px;
				color: var(--text-3);
				margin-top: 2px;
			}
			.tk-drop {
				height: 115px;
			}
			.tk-controls {
				display: flex;
				gap: 10px;
				align-items: flex-end;
				flex-wrap: wrap;
			}
			.tk-controls label {
				display: flex;
				flex-direction: column;
				gap: 4px;
				font-size: 11.5px;
				color: var(--text-2);
			}
			.tk-controls select, .tk-controls input[type="number"] {
				padding: 6px 9px;
				background: var(--bg-0);
				border: 1px solid var(--line);
				border-radius: var(--radius-sm);
				color: var(--text-1);
				font: inherit;
				font-size: 12.5px;
			}
			.tk-list {
				display: flex;
				flex-direction: column;
				gap: 8px;
				max-height: 270px;
				overflow-y: auto;
			}
			.tk-empty {
				padding: 18px 12px;
				text-align: center;
				color: var(--text-3);
				font-size: 12.5px;
				background: var(--bg-0);
				border: 1px dashed var(--line-soft);
				border-radius: var(--radius-sm);
			}
			.tk-item {
				display: flex;
				justify-content: space-between;
				align-items: center;
				gap: 10px;
				padding: 9px 11px;
				background: var(--bg-2);
				border: 1px solid var(--line-soft);
				border-radius: var(--radius-sm);
			}
			.tk-item-info { min-width: 0; flex: 1; }
			.tk-item-name {
				font-size: 12px;
				color: var(--text-1);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.tk-item-meta {
				display: flex;
				align-items: center;
				gap: 6px;
				flex-wrap: wrap;
				font-size: 11px;
				color: var(--text-3);
				margin-top: 3px;
			}
			.tk-badge {
				padding: 1px 6px;
				border-radius: 999px;
				font-size: 10px;
				font-weight: 700;
				font-family: var(--mono);
			}
			.tk-badge.is-ok { background: rgba(65, 184, 131, .16); color: var(--ok); }
			.tk-badge.is-info { background: var(--cyan-dim); color: var(--accent-cyan); }
			.tk-badge.is-warn { background: rgba(223, 181, 63, .16); color: var(--warn); }
			.tk-badge.is-err { background: rgba(229, 83, 75, .16); color: var(--err); }
			.tk-item-actions {
				display: flex;
				gap: 6px;
				flex: none;
			}
			.tk-cmd-bar {
				display: flex;
				gap: 8px;
				align-items: center;
				background: var(--bg-0);
				border: 1px solid var(--line-soft);
				border-radius: var(--radius-sm);
				padding: 6px 9px;
			}
			.tk-cmd-bar input {
				flex: 1;
				background: transparent;
				border: none;
				color: var(--accent-cyan);
				font-family: var(--mono);
				font-size: 11.5px;
				outline: none;
			}
			.toast.t-warn { border-left-color: var(--warn); }
		`;
		document.head.appendChild(style);
	}

	// Inject 3rd tab button if missing
	const tabsNav = document.querySelector('.tabs');
	if (tabsNav && !$('tabBtnToolkit')) {
		const btn = document.createElement('button');
		btn.className = 'tab';
		btn.id = 'tabBtnToolkit';
		btn.setAttribute('role', 'tab');
		btn.setAttribute('aria-selected', 'false');
		btn.dataset.tab = 'toolkit';
		btn.innerHTML = `FFMPEG Toolkit`;
		tabsNav.appendChild(btn);
	}

	// Inject FFMPEG Toolkit link in topbar if missing
	const topbarRight = document.querySelector('.topbar-right');
	if (topbarRight && !$('btnTopToolkit') &&$('tabBatch')) {
		const linkBtn = document.createElement('a');
		linkBtn.id = 'btnTopToolkit';
		linkBtn.href = 'ffmpeg-tools.html';
		linkBtn.className = 'btn btn-ghost btn-mini';
		linkBtn.title = 'Open standalone FFMPEG Tools page or switch tab';
		linkBtn.textContent = 'FFMPEG Tools';
		linkBtn.onclick = e => {
			if ($('tabToolkit')) {
				e.preventDefault();
				switchTab('toolkit');
			}
		};
		topbarRight.insertBefore(linkBtn, topbarRight.firstChild);
	}

	// Inject Toolkit Section inside .stage if missing
	const stage = document.querySelector('.stage');
	if (stage && !$('tabToolkit')) {
		const sec = document.createElement('section');
		sec.id = 'tabToolkit';
		sec.setAttribute('role', 'tabpanel');
		sec.hidden = true;
		sec.innerHTML = buildToolkitMarkup();
		stage.appendChild(sec);
	}
}

function buildToolkitMarkup() {
	return `
		<div class="tk-grid">
			<!-- Card 1: Faststart moov Atom Repair -->
			<div class="tk-card">
				<div class="tk-card-head">
					<div>
						<div class="tk-card-title">
							<svg viewBox="0 0 24 24" class="icon" style="color:var(--accent)"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
							MP4 Faststart Repair (moov Atom Fix)
						</div>
						<div class="tk-card-sub">Fixes <code>ffprobe duration='N/A'</code> & HTTP 415 by moving the <code>moov</code> atom to the front (<code>-movflags +faststart -c copy</code>).</div>
					</div>
					<div style="display:flex;gap:6px">
						<button class="btn btn-mini btn-primary" id="btnFaststartDownloadAll" disabled>Download All (_f.mp4)</button>
						<button class="btn btn-mini btn-ghost" id="btnFaststartClear">Clear</button>
					</div>
				</div>

				<div class="tk-controls">
					<label class="switch">
						<input type="checkbox" id="chkAutoFaststart" checked>
						<span class="track"></span>
						<span class="switch-label">Auto-fix on Source/Target upload</span>
					</label>
					<label class="switch">
						<input type="checkbox" id="chkAutoSaveFixed">
						<span class="track"></span>
						<span class="switch-label">Auto-download repaired <code>_f.mp4</code></span>
					</label>
				</div>

				<div class="dropzone tk-drop" id="zoneFaststart" tabindex="0" role="button" aria-label="Upload broken MP4 videos for faststart repair">
					<input type="file" id="inputFaststart" accept="video/mp4,video/quicktime,video/x-m4v,audio/mp4,.mp4,.mov,.m4v,.m4a" multiple hidden>
					<div class="dropzone-empty">
						<p>Drop broken <b>.mp4 / .mov</b> files here (batch supported)<br><span>or click to browse — outputs <code>filename_f.mp4</code></span></p>
					</div>
				</div>

				<div class="tk-list" id="faststartList">
					<div class="tk-empty">No videos queued yet. Drop .mp4 / .mov files above to relocate the <code>moov</code> atom to the front.</div>
				</div>
			</div>

			<!-- Card 2: Lossless <500 MB Segment Splitter -->
			<div class="tk-card">
				<div class="tk-card-head">
					<div>
						<div class="tk-card-title">
							<svg viewBox="0 0 24 24" class="icon" style="color:var(--accent-cyan)"><path d="M6 6h12M6 12h12M6 18h12M3 6h.01M3 12h.01M3 18h.01" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
							Lossless Video Splitter (&lt;500 MB API Limit)
						</div>
						<div class="tk-card-sub">Slices large MP4s on keyframes without re-encoding and places <code>moov</code> at the front of every part.</div>
					</div>
				</div>

				<div class="tk-controls">
					<label>
						<span>Split mode</span>
						<select id="splitMode">
							<option value="size">Fit &lt;500 MB API limit (Max MB per part)</option>
							<option value="duration">Fixed duration (Seconds per part)</option>
						</select>
					</label>
					<label>
						<span id="splitValueLabel">Max part size (MB)</span>
						<input type="number" id="splitValue" value="450" min="5" max="2000" step="10" style="width:110px">
					</label>
					<button class="btn btn-primary" id="btnSplitRun" disabled>Select a video below</button>
				</div>

				<div class="dropzone tk-drop" id="zoneSplitter" tabindex="0" role="button" aria-label="Upload large MP4 video to split into segments">
					<input type="file" id="inputSplitter" accept="video/mp4,video/quicktime,.mp4,.mov" hidden>
					<div class="dropzone-empty">
						<p>Drop a large <b>.mp4</b> video (&gt;500 MB or any size)<br><span>lossless stream copy · instant keyframe slicing</span></p>
					</div>
				</div>

				<div class="tk-list" id="splitterList">
					<div class="tk-empty">Drop a large video (&gt;500 MB) above to slice it into API-ready segments with <code>moov</code> at the front.</div>
				</div>
			</div>
		</div>

		<div class="tk-cmd-bar">
			<span class="mono" style="font-size:11px;color:var(--text-3)">Terminal Batch CMD:</span>
			<input type="text" id="ffmpegCmdBox" readonly value='for %I in (*.mp4) do ffmpeg -i "%I" -movflags faststart -c copy "%~nI_f.mp4"'>
			<button class="btn btn-mini" id="btnCopyCmd">Copy CMD</button>
		</div>
	`;
}

function wireDropzone(zone, input, onFiles) {
	if (!zone || !input) return;
	zone.addEventListener('click', e => {
		if (!e.target.closest('.thumb') && !e.target.closest('button')) input.click();
	});
	zone.addEventListener('keydown', e => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			input.click();
		}
	});
	zone.addEventListener('dragover', e => {
		e.preventDefault();
		zone.classList.add('is-drag');
	});
	zone.addEventListener('dragleave', () => zone.classList.remove('is-drag'));
	zone.addEventListener('drop', e => {
		e.preventDefault();
		zone.classList.remove('is-drag');
		onFiles([...e.dataTransfer.files]);
	});
	input.addEventListener('change', () => {
		onFiles([...input.files]);
		input.value = '';
	});
}

async function connect() {
	if (dom.cfgUrl) Config.baseUrl = dom.cfgUrl.value.trim() || 'http://127.0.0.1:8000';
	if (dom.cfgKey && dom.cfgRemember) Config.setApiKey(dom.cfgKey.value.trim(), dom.cfgRemember.checked);
	if (dom.settingsModal) dom.settingsModal.hidden = true;
	try {
		await Session.connect();
		toast('Connected to FaceFusion API', 'ok');
	} catch (e) {
		toast('Connection failed: ' + e.message, 'error');
	}
}

/* ── Application Boot ────────────────────────────────────────────────────── */
function boot() {
	ensureModernUiAndToolkit();
	bindDom();

	// Wire main console if present
	if (dom.cfgUrl) dom.cfgUrl.value = Config.baseUrl;
	if (dom.cfgKey) dom.cfgKey.value = Config.apiKey;
	if (dom.cfgRemember) dom.cfgRemember.checked = !!localStorage.getItem('ff.apiKey');

	if (dom.btnSettings) {
		dom.btnSettings.onclick = () => {
			dom.settingsModal.hidden = false;
			dom.cfgUrl.focus();
		};
	}
	if (dom.btnSettingsClose) dom.btnSettingsClose.onclick = () => { dom.settingsModal.hidden = true; };
	if (dom.btnConnect) dom.btnConnect.onclick = connect;
	if (dom.btnDisconnect) dom.btnDisconnect.onclick = () => Session.disconnect();
	if (dom.settingsModal) {
		dom.settingsModal.addEventListener('click', e => {
			if (e.target === dom.settingsModal) dom.settingsModal.hidden = true;
		});
	}

	if (dom.btnFacesClose) dom.btnFacesClose.onclick = () => { dom.facesModal.hidden = true; };
	if (dom.facesModal) {
		dom.facesModal.addEventListener('click', e => {
			if (e.target === dom.facesModal) dom.facesModal.hidden = true;
		});
	}

	document.addEventListener('keydown', e => {
		if (e.key === 'Escape') {
			if (dom.settingsModal) dom.settingsModal.hidden = true;
			if (dom.facesModal) dom.facesModal.hidden = true;
		}
	});

	wireDropzone(dom.zoneSource, dom.inputSource, files => Assets.upload('source', files));
	wireDropzone(dom.zoneTarget, dom.inputTarget, files => Assets.upload('target', files));

	if (dom.btnRun) dom.btnRun.onclick = () => Jobs.runPipeline();
	if (dom.btnJobsRefresh) dom.btnJobsRefresh.onclick = () => Jobs.refresh();

	if (dom.tabBtnBatch) dom.tabBtnBatch.onclick = () => switchTab('batch');
	if (dom.tabBtnStream) dom.tabBtnStream.onclick = () => switchTab('stream');
	if (dom.tabBtnToolkit) dom.tabBtnToolkit.onclick = () => switchTab('toolkit');

	if (dom.btnStreamStart) dom.btnStreamStart.onclick = () => Stream.startWebcam();
	if (dom.btnStreamImage) dom.btnStreamImage.onclick = () => dom.inputStreamImage.click();
	if (dom.inputStreamImage) {
		dom.inputStreamImage.onchange = () => {
			if (dom.inputStreamImage.files[0]) Stream.sendImage(dom.inputStreamImage.files[0]);
			dom.inputStreamImage.value = '';
		};
	}
	if (dom.btnStreamStop) dom.btnStreamStop.onclick = () => Stream.stop();

	if (dom.viewResult) dom.viewResult.onclick = () => Output.setView('result');
	if (dom.viewCompare) dom.viewCompare.onclick = () => Output.setView('compare');
	if (dom.compareSlider) dom.compareSlider.oninput = () => Output.syncCompare();
	window.addEventListener('resize', () => {
		if (dom.compareWrap && !dom.compareWrap.hidden) Output.syncCompare();
	});

	if (dom.optionFilter) dom.optionFilter.oninput = () => Options.filter(dom.optionFilter.value);

	// Wire FFMPEG Toolkit controls
	wireDropzone(dom.zoneFaststart, dom.inputFaststart, files => Toolkit.addFaststartFiles(files));
	wireDropzone(dom.zoneSplitter, dom.inputSplitter, files => Toolkit.loadSplitterFile(files[0]));

	if (dom.btnFaststartDownloadAll) dom.btnFaststartDownloadAll.onclick = () => Toolkit.downloadAllFaststart();
	if (dom.btnFaststartClear) dom.btnFaststartClear.onclick = () => Toolkit.clearFaststart();

	if (dom.chkAutoFaststart) {
		dom.chkAutoFaststart.checked = Config.autoFaststart;
		dom.chkAutoFaststart.onchange = () => { Config.autoFaststart = dom.chkAutoFaststart.checked; };
	}
	if (dom.chkAutoSaveFixed) {
		dom.chkAutoSaveFixed.checked = Config.autoSaveFixed;
		dom.chkAutoSaveFixed.onchange = () => { Config.autoSaveFixed = dom.chkAutoSaveFixed.checked; };
	}

	if (dom.splitMode) {
		dom.splitMode.onchange = () => {
			const isDur = dom.splitMode.value === 'duration';
			if (dom.splitValueLabel) dom.splitValueLabel.textContent = isDur ? 'Segment duration (sec)' : 'Max part size (MB)';
			if (dom.splitValue) dom.splitValue.value = isDur ? 60 : 450;
			Toolkit.updateCliPreview();
		};
	}
	if (dom.splitValue) dom.splitValue.oninput = () => Toolkit.updateCliPreview();
	if (dom.btnSplitRun) dom.btnSplitRun.onclick = () => Toolkit.runSplitter();

	if (dom.btnCopyCmd && dom.ffmpegCmdBox) {
		dom.btnCopyCmd.onclick = () => {
			navigator.clipboard.writeText(dom.ffmpegCmdBox.value).then(() => toast('FFMPEG command copied to clipboard', 'ok'));
		};
	}

	// Load capabilities if on main console page
	if (dom.optionsGroups) {
		Options.load().catch(() => {
			dom.optionsGroups.innerHTML = '<div class="options-placeholder">API unreachable — check the server, then reconnect. Options will load automatically afterwards.</div>';
		});
		if (Config.wasConnected) connect();
		else if (dom.settingsModal) dom.settingsModal.hidden = false;
	}
}

document.addEventListener('DOMContentLoaded', boot);