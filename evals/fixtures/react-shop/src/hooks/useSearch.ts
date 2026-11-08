import { useEffect, useState } from "react";

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; results: string[] }
  | { status: "error"; message: string };

export function useSearch(query: string) {
  const [state, setState] = useState<SearchState>({ status: "idle" });

  useEffect(() => {
    if (!query) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((results: string[]) => setState({ status: "done", results }))
      .catch((e) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: String(e) });
      });
    return () => controller.abort();
  }, [query]);

  return state;
}
