import { useMemo, useState } from "react";
import type { CoreNode } from "./protocol";

type Props = {
  node: CoreNode | null;
  onClose: () => void;
  onDelete?: (nodeId: string) => void;
  onPatch?: (nodeId: string, props: Record<string, any>) => void;
  onOpenCredentials?: (provider: string) => void;
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ConfigPanel(props: Props): JSX.Element {
  const isOpen = Boolean(props.node);
  const headerLabel = props.node?.label ?? (props.node ? `${props.node.kind}: ${props.node.name}` : "");
  const [activeTab, setActiveTab] = useState<"config" | "json">("config");

  const propsText = useMemo(() => {
    if (!props.node) return "";
    if (!props.node.props) return "";
    return prettyJson(props.node.props);
  }, [props.node]);

  return (
    <aside
      className={
        "holonConfigPanel transition-all duration-700 cubic-bezier(0.19, 1, 0.22, 1) " +
        (isOpen ? "w-[500px] border-l border-white/10" : "w-0 border-l-0 opacity-0")
      }
      style={{ minWidth: isOpen ? '500px' : '0' }}
      aria-hidden={!isOpen}
    >
      <div className="h-full w-[500px] flex flex-col overflow-hidden">
        {/* Header Area */}
        <div className="flex items-start justify-between gap-6 px-12 pt-16 pb-10">
          <div className="min-w-0">
             <div className="text-[10px] font-black uppercase tracking-[0.5em] text-blue-500 mb-3">Holon System v4.0</div>
            <h2 className="text-4xl font-black tracking-tighter text-white uppercase italic leading-tight">Inspector</h2>
            <div className="mt-4 text-xs text-white/40 truncate font-semibold tracking-wide border-l-2 border-white/10 pl-4">{headerLabel}</div>
          </div>
          <button
            type="button"
            className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white text-white/40 hover:text-black transition-all transform hover:rotate-90 duration-500 shadow-2xl"
            onClick={props.onClose}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {props.node ? (
          <div className="flex flex-1 flex-col min-h-0">
            {/* Meta Section */}
            <div className="px-12 pb-12 flex items-center gap-4">
              <span className="px-4 py-2 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-[0.2em] shadow-lg shadow-blue-500/20">
                {props.node.kind}
              </span>
              {props.node.nodeType ? (
                <span className="px-4 py-2 rounded-xl bg-white/5 text-white/80 text-[10px] font-black uppercase tracking-[0.2em] border border-white/10">
                  {props.node.nodeType}
                </span>
              ) : null}
              {props.node.nodeType === "llm.model" && props.onOpenCredentials && (
                <button
                  type="button"
                  onClick={() => props.onOpenCredentials!((props.node?.props?.provider as string) || "openai")}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-blue-500/20 text-white text-[10px] font-black uppercase tracking-[0.2em] border border-white/10 hover:border-blue-500/30 transition-all ml-auto"
                >
                  Configure Credentials
                </button>
              )}
            </div>

            {/* Nav Tabs */}
            <div className="px-12 flex gap-10 border-b border-white/5">
              <button
                type="button"
                className={
                  "pb-8 text-[11px] font-black uppercase tracking-[0.3em] transition-all relative " +
                  (activeTab === "config" ? "text-blue-400" : "text-white/20 hover:text-white/40")
                }
                onClick={() => setActiveTab("config")}
              >
                Configuration
                {activeTab === "config" && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-blue-500 rounded-t-full shadow-[0_-4px_10px_rgba(59,130,246,0.5)]" />}
              </button>
              <button
                type="button"
                className={
                  "pb-8 text-[11px] font-black uppercase tracking-[0.3em] transition-all relative " +
                  (activeTab === "json" ? "text-blue-400" : "text-white/20 hover:text-white/40")
                }
                onClick={() => setActiveTab("json")}
              >
                Raw Source
                {activeTab === "json" && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-blue-500 rounded-t-full shadow-[0_-4px_10px_rgba(59,130,246,0.5)]" />}
              </button>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
              <div className="p-12 space-y-20">
                {activeTab === "config" ? (
                  <>
                    <section className="space-y-8">
                      <h3 className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">Core Summary</h3>
                      <div className="relative">
                        <div className="absolute -left-6 top-0 bottom-0 w-1.5 bg-blue-500/30 rounded-full" />
                        <p className="text-lg leading-relaxed text-white/90 font-medium italic">
                          {props.node.summary ? props.node.summary : "No semantic analysis available. Process this node with AI to generate insights."}
                        </p>
                      </div>
                    </section>

                    {props.node.badges && props.node.badges.length > 0 && (
                      <section className="space-y-8">
                        <h3 className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">System Traits</h3>
                        <div className="flex flex-wrap gap-4">
                          {props.node.badges.map((b) => (
                            <span key={b} className="px-5 py-2.5 rounded-2xl bg-white/5 border border-white/5 text-[12px] text-white/50 font-black uppercase tracking-widest hover:border-white/20 transition-colors">
                              {b}
                            </span>
                          ))}
                        </div>
                      </section>
                    )}

                    {props.node.props && (
                      <section className="space-y-8">
                        <h3 className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">State Properties</h3>
                        <div className="space-y-6">
                           {Object.entries(props.node.props).map(([key, value]) => (
                             <div key={key} className="space-y-3">
                               <div className="flex justify-between items-center px-1">
                                 <label className="text-[10px] font-black uppercase tracking-[0.2em] text-white/30">{key}</label>
                               </div>
                               <textarea
                                 className="w-full bg-black/40 border border-white/5 rounded-3xl p-6 text-[13px] text-blue-100/80 font-medium leading-relaxed focus:outline-none focus:border-blue-500/30 focus:bg-blue-500/5 transition-all resize-none overflow-hidden"
                                 defaultValue={typeof value === 'string' ? value : JSON.stringify(value)}
                                 onBlur={(e) => {
                                   const newVal = e.target.value;
                                   let parsedVal: any = newVal;
                                   if (typeof value === 'number') {
                                       parsedVal = Number(newVal);
                                   } else if (typeof value === 'boolean') {
                                       parsedVal = newVal.toLowerCase() === 'true';
                                   } else if (typeof value === 'object' && value !== null) {
                                       try {
                                           parsedVal = JSON.parse(newVal);
                                       } catch {
                                           // fallback to original or string
                                       }
                                   }
                                   
                                   if (JSON.stringify(parsedVal) !== JSON.stringify(value)) {
                                       props.onPatch?.(props.node!.id, { ...props.node!.props, [key]: parsedVal });
                                   }
                                 }}
                                 onInput={(e) => {
                                   const target = e.target as HTMLTextAreaElement;
                                   target.style.height = 'auto';
                                   target.style.height = target.scrollHeight + 'px';
                                 }}
                                 ref={(el) => {
                                   if (el) {
                                     el.style.height = 'auto';
                                     el.style.height = el.scrollHeight + 'px';
                                   }
                                 }}
                               />
                             </div>
                           ))}
                        </div>
                      </section>
                    )}

                    {props.onDelete && (props.node.id.startsWith("node:") || props.node.id.startsWith("spec:")) && (
                      <section className="pt-10">
                        <button
                          type="button"
                          className="w-full py-6 rounded-3xl bg-red-500/5 hover:bg-red-500 text-red-500 hover:text-white text-[11px] font-black uppercase tracking-[0.4em] transition-all border border-red-500/10 hover:border-red-500 shadow-xl hover:shadow-red-500/20"
                          onClick={() => props.onDelete?.(props.node!.id)}
                        >
                          Erase Definition
                        </button>
                      </section>
                    )}
                    <div className="h-20" />
                  </>
                ) : (
                  <section className="space-y-8 h-full">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">Source JSON</h3>
                    <div className="rounded-[40px] bg-black/50 border border-white/5 h-full p-10 shadow-inner">
                      <pre className="text-[11px] leading-6 text-white/10 font-mono h-full overflow-auto custom-scrollbar">
                        {prettyJson(props.node)}
                      </pre>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-24 text-center space-y-10">
            <div className="w-32 h-32 rounded-[50px] bg-white/5 flex items-center justify-center rotate-12 transition-transform hover:rotate-0 duration-700 shadow-2xl border border-white/5">
               <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5" strokeOpacity="0.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
            </div>
            <div className="space-y-4">
              <p className="text-white/30 text-xs font-black uppercase tracking-[0.3em] leading-loose">
                Waiting for node selection
              </p>
              <p className="text-white/10 text-[10px] font-medium max-w-[240px] mx-auto">
                Selected node metadata will appear here in the neural inspector.
              </p>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
