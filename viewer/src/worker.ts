// worker.ts
export type ResultTuple = [id: string, content: string, score: number];
export type SortKey = "time" | "score";
export type SortOrder = "asc" | "desc";

type WorkerRequest =
	| {
			type: "load";
			requestId: number;
			url: string;
			sortKey: SortKey;
			order: SortOrder;
	  }
	| { type: "sort"; requestId: number; sortKey: SortKey; order: SortOrder };

type WorkerResponse =
	| { type: "ready"; requestId: number; data: ResultTuple[] }
	| { type: "error"; requestId: number; message: string };

let data: ResultTuple[] | null = null;

function isValidTuple(x: any): x is ResultTuple {
	return (
		Array.isArray(x) &&
		x.length === 3 &&
		typeof x[0] === "string" &&
		typeof x[1] === "string" &&
		typeof x[2] === "number" &&
		Number.isFinite(x[2])
	);
}

function compareAsTime(a: ResultTuple, b: ResultTuple) {
	// Tweet IDは概ね時系列に増加する想定。BigIntで比較。
	try {
		const ai = BigInt(a[0]);
		const bi = BigInt(b[0]);
		return ai < bi ? -1 : ai > bi ? 1 : 0;
	} catch {
		return a[0].localeCompare(b[0]);
	}
}

function sortData(
	input: ResultTuple[],
	sortKey: SortKey,
	order: SortOrder,
): ResultTuple[] {
	const dir = order === "asc" ? 1 : -1;
	const copied = input.slice();

	copied.sort((a, b) => {
		let c = 0;
		if (sortKey === "time") c = compareAsTime(a, b);
		else c = a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;

		return c * dir;
	});

	return copied;
}

async function loadJson(url: string): Promise<ResultTuple[]> {
	const res = await fetch(url, { cache: "no-store" });
	if (!res.ok) {
		throw new Error(
			`viewer/ に置いてください (fetch failed: ${res.status} ${res.statusText})`,
		);
	}
	const json = await res.json();

	if (!Array.isArray(json)) throw new Error("results.json is not an array");

	const out: ResultTuple[] = [];
	for (let i = 0; i < json.length; i++) {
		const row = json[i];
		if (!isValidTuple(row)) continue;
		out.push(row);
	}
	return out;
}

function post(msg: WorkerResponse) {
	(self as any).postMessage(msg);
}

self.addEventListener("message", async (ev: MessageEvent<WorkerRequest>) => {
	const msg = ev.data;

	try {
		if (msg.type === "load") {
			const loaded = await loadJson(msg.url);
			data = loaded;
			const sorted = sortData(loaded, msg.sortKey, msg.order);
			post({ type: "ready", requestId: msg.requestId, data: sorted });
			return;
		}

		if (msg.type === "sort") {
			if (!data) throw new Error("data is not loaded yet");
			const sorted = sortData(data, msg.sortKey, msg.order);
			post({ type: "ready", requestId: msg.requestId, data: sorted });
			return;
		}

		throw new Error("unknown message type");
	} catch (e: any) {
		post({
			type: "error",
			requestId: msg.requestId,
			message: e?.message ?? String(e),
		});
	}
});
