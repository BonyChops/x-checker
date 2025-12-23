// App.tsx

import { useVirtualizer } from "@tanstack/react-virtual";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";

type ResultTuple = [id: string, content: string, score: number];

type SortKey = "time" | "score";
type SortOrder = "asc" | "desc";

type WorkerRequest =
	| {
			type: "load";
			requestId: number;
			url: string;
			sortKey: SortKey;
			order: SortOrder;
	  }
	| { type: "sort"; requestId: number; sortKey: SortKey; order: SortOrder };

type WorkerRequestBase =
	| { type: "load"; url: string; sortKey: SortKey; order: SortOrder }
	| { type: "sort"; sortKey: SortKey; order: SortOrder };

type WorkerResponse =
	| { type: "ready"; requestId: number; data: ResultTuple[] }
	| { type: "error"; requestId: number; message: string };

type Resource<T> = { read(): T };
function wrapPromise<T>(p: Promise<T>): Resource<T> {
	let status: "pending" | "success" | "error" = "pending";
	let result: T;
	let error: unknown;
	const suspender = p.then(
		(r) => {
			status = "success";
			result = r;
		},
		(e) => {
			status = "error";
			error = e;
		},
	);

	return {
		read() {
			if (status === "pending") throw suspender;
			if (status === "error") throw error;
			return result!;
		},
	};
}

function makeLink(id: string) {
	return `https://x.com/x/status/${encodeURIComponent(id)}`;
}

function ResultsTable({ resource }: { resource: Resource<ResultTuple[]> }) {
	const data = resource.read();
	const parentRef = useRef<HTMLDivElement | null>(null);

	const rowVirtualizer = useVirtualizer({
		count: data.length,
		getScrollElement: () => parentRef.current,
		estimateSize: () => 44,
		overscan: 10,
	});

	const virtualItems = rowVirtualizer.getVirtualItems();
	const totalSize = rowVirtualizer.getTotalSize();

	const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
	const paddingBottom =
		virtualItems.length > 0
			? totalSize - virtualItems[virtualItems.length - 1].end
			: 0;

	return (
		<div
			ref={parentRef}
			style={{
				height: "80vh",
				overflow: "auto",
				border: "1px solid #ddd",
				borderRadius: 8,
			}}
		>
			<table
				style={{
					borderCollapse: "collapse",
					width: "100%",
					tableLayout: "fixed",
					minWidth: 700,
				}}
			>
				<colgroup>
					<col style={{ width: 220 }} />
					<col style={{ width: "calc(100% - 460px)" }} />
					<col style={{ width: 120 }} />
					<col style={{ width: 120 }} />
				</colgroup>

				<thead
					style={{
						position: "sticky",
						top: 0,
						zIndex: 2,
						background: "white",
						borderBottom: "1px solid #ddd",
					}}
				>
					<tr>
						<th style={thStyle()}>id</th>
						<th style={thStyle()}>内容</th>
						<th style={thStyle()}>score</th>
						<th style={thStyle()}>link</th>
					</tr>
				</thead>

				{/* ✅ tbody は block にしない */}
				<tbody>
					{/* ✅ 上の空白（スペーサー） */}
					{paddingTop > 0 && (
						<tr>
							<td
								colSpan={4}
								style={{ height: paddingTop, padding: 0, border: 0 }}
							/>
						</tr>
					)}

					{/* ✅ 実データ行は普通に描画 */}
					{virtualItems.map((v) => {
						const [id, content, score] = data[v.index];
						return (
							<tr key={v.key} style={trStyle}>
								<td style={tdStyle()} title={id}>
									{id}
								</td>
								<td style={tdStyle()} title={content}>
									{content}
								</td>
								<td style={tdStyle()}>{score}</td>
								<td style={tdStyle()}>
									<a href={makeLink(id)} target="_blank" rel="noreferrer">
										LINK
									</a>
								</td>
							</tr>
						);
					})}

					{/* ✅ 下の空白（スペーサー） */}
					{paddingBottom > 0 && (
						<tr>
							<td
								colSpan={4}
								style={{ height: paddingBottom, padding: 0, border: 0 }}
							/>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

function thStyle(): React.CSSProperties {
	return {
		textAlign: "left",
		padding: "10px 12px",
		fontWeight: 600,
		fontSize: 14,
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	};
}

function tdStyle(): React.CSSProperties {
	return {
		padding: "10px 12px",
		fontSize: 14,
		verticalAlign: "middle",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	};
}

const trStyle: React.CSSProperties = {
	borderBottom: "1px solid #eee",
	background: "white",
};

export default function App() {
	const worker = useMemo(() => {
		return new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
	}, []);

	const requestIdRef = useRef(1);
	const pendingRef = useRef(
		new Map<
			number,
			{ resolve: (d: ResultTuple[]) => void; reject: (e: any) => void }
		>(),
	);

	const [sortKey, setSortKey] = useState<SortKey>("time");
	const [order, setOrder] = useState<SortOrder>("desc");

	const [error, setError] = useState<string | null>(null);
	const [resource, setResource] = useState<Resource<ResultTuple[]> | null>(
		null,
	);

	useEffect(() => {
		const onMessage = (ev: MessageEvent<WorkerResponse>) => {
			const msg = ev.data;
			const pending = pendingRef.current.get(msg.requestId);
			if (!pending) return;

			if (msg.type === "ready") {
				pending.resolve(msg.data);
			} else {
				pending.reject(new Error(msg.message));
			}
			pendingRef.current.delete(msg.requestId);
		};

		worker.addEventListener("message", onMessage);
		return () => worker.removeEventListener("message", onMessage);
	}, [worker]);

	function callWorker(req: WorkerRequestBase): Promise<ResultTuple[]> {
		const requestId = requestIdRef.current++;
		const fullReq: WorkerRequest = { ...req, requestId };

		const p = new Promise<ResultTuple[]>((resolve, reject) => {
			pendingRef.current.set(requestId, { resolve, reject });
			worker.postMessage(fullReq);
		});

		return p;
	}

	// 初回ロード（Worker側で fetch + 検証 + ソート）
	useEffect(() => {
		setError(null);

		const p = callWorker({
			type: "load",
			url: "/results.json",
			sortKey,
			order,
		});
		setResource(wrapPromise(p));

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [worker]); // 初回のみ

	// ソート変更時（Workerでソート）
	useEffect(() => {
		if (!resource) return;
		setError(null);

		const p = callWorker({ type: "sort", sortKey, order });
		setResource(wrapPromise(p));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sortKey, order]);

	// WorkerエラーをUIに出す（Suspense境界内で投げられたErrorをここで受けないので、fallbackとは別で表示したい場合）
	// → wrapPromise内でthrowされたErrorは ErrorBoundary が必要。
	// ここでは最小構成として、resource.read() で投げられるErrorをキャッチする ErrorBoundary を自前で用意します。
	return (
		<div
			style={{
				padding: 16,
				fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
			}}
		>
			<h1 style={{ margin: "0 0 12px" }}>Results</h1>

			<div
				style={{
					display: "flex",
					gap: 12,
					alignItems: "center",
					marginBottom: 12,
				}}
			>
				<label style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span>並び</span>
					<select
						value={sortKey}
						onChange={(e) => setSortKey(e.target.value as SortKey)}
					>
						<option value="time">時系列</option>
						<option value="score">score順</option>
					</select>
				</label>

				<label style={{ display: "flex", gap: 8, alignItems: "center" }}>
					<span>順序</span>
					<select
						value={order}
						onChange={(e) => setOrder(e.target.value as SortOrder)}
					>
						<option value="asc">昇順</option>
						<option value="desc">降順</option>
					</select>
				</label>
			</div>

			<ErrorBoundary onError={(msg) => setError(msg)}>
				<Suspense
					fallback={<div style={{ padding: 12 }}>読み込んでいます...</div>}
				>
					{resource ? (
						<ResultsTable resource={resource} />
					) : (
						<div style={{ padding: 12 }}>初期化中...</div>
					)}
				</Suspense>
			</ErrorBoundary>

			{error ? (
				<div style={{ marginTop: 12, color: "#b00020" }}>
					results.jsonの読み込み/処理に失敗しました: {error}
				</div>
			) : null}

			<div style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
				※ results.json の読み込み/ソートは Web Worker で実行します。
			</div>
		</div>
	);
}

class ErrorBoundary extends React.Component<
	{ children: React.ReactNode; onError: (message: string) => void },
	{ hasError: boolean }
> {
	state = { hasError: false };

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: any) {
		this.props.onError(error?.message ?? String(error));
	}

	componentDidUpdate(prevProps: any) {
		// 次の試行で復帰できるように
		if (this.state.hasError && prevProps.children !== this.props.children) {
			// eslint-disable-next-line react/no-did-update-set-state
			this.setState({ hasError: false });
		}
	}

	render() {
		if (this.state.hasError) return null;
		return this.props.children;
	}
}
