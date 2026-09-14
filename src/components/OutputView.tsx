import { useEffect, useRef, useState } from "react";
import { ArrowDown, Terminal } from "lucide-react";

import type { OutputLine } from "../hooks/useSidecar";

interface OutputViewProps {
  lines: OutputLine[];
}

export function OutputView({ lines }: OutputViewProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const [showLatest, setShowLatest] = useState(false);

  useEffect(() => {
    if (!autoScrollRef.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;

    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    autoScrollRef.current = atBottom;
    setShowLatest(!atBottom);
  }

  function scrollToLatest() {
    const element = scrollRef.current;
    if (!element) return;

    autoScrollRef.current = true;
    setShowLatest(false);
    element.scrollTop = element.scrollHeight;
  }

  return (
    <section className="run-output">
      <div className="run-output-header">
        <div className="output-title">
          <Terminal size={16} aria-hidden="true" />
          <span>实时输出</span>
        </div>
        <span>{lines.length} 行</span>
      </div>

      <div
        className="run-output-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <div className="run-output-empty">
            <Terminal size={36} strokeWidth={1.5} aria-hidden="true" />
            <span>等待 Agent 输出</span>
          </div>
        ) : (
          lines.map((line) => (
            <div
              className={`run-output-line ${line.stream}`}
              key={line.key}
            >
              <span className="run-output-agent">[{line.agentId}]</span>
              <span className="run-output-text">{line.line}</span>
            </div>
          ))
        )}
      </div>

      {showLatest && (
        <button
          type="button"
          className="back-to-latest"
          onClick={scrollToLatest}
        >
          <ArrowDown size={15} aria-hidden="true" />
          回到最新
        </button>
      )}
    </section>
  );
}
