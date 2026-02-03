import { useMemo, useState, useEffect } from "react";
import type { CoreNode } from "./protocol";
import { useCredentialsStore } from "./store/credentials.store";
import { useModelsStore } from "./store/models.store";
import CustomSelect from './components/CustomSelect';

type Props = {
  node: CoreNode | null;
  onClose: () => void;
  onDelete?: (nodeId: string) => void;
  onPatch?: (nodeId: string, props: Record<string, any>) => void;
  onOpenCredentials?: (provider: string) => void;
  onRunWorkflow?: () => void;
  executionOutput?: Record<string, any> | null;
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
  const [activeTab, setActiveTab] = useState<"config" | "output">("config");
  
  // Stores
  const credentialsStore = useCredentialsStore();
  const modelsStore = useModelsStore();
  
  // Available providers (for now only OpenAI)
  const availableProviders = ['openai'];
  
  // Get current provider and model from node props
  const currentProvider = props.node?.props?.provider as string | undefined;
  const currentModel = props.node?.props?.model_name as string | undefined;
  
  // Load models when provider changes
  useEffect(() => {
    if (currentProvider && props.node?.nodeType === 'llm.model') {
      const apiKey = credentialsStore.actions.getCredentials(currentProvider)?.api_key;
      console.log('[ConfigPanel] Loading models for provider:', currentProvider, 'has API key:', !!apiKey);
      modelsStore.actions.loadModels(currentProvider, apiKey);
    }
  }, [currentProvider, props.node?.nodeType, credentialsStore.credentials]);
  
  // Get available models for current provider
  const availableModels = currentProvider ? modelsStore.actions.getModels(currentProvider) : [];

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
              {props.onRunWorkflow && (
                <button
                  type="button"
                  onClick={props.onRunWorkflow}
                  className="ml-auto px-4 py-2 rounded-2xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
                >
                  Run Workflow
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
                  (activeTab === "output" ? "text-blue-400" : "text-white/20 hover:text-white/40")
                }
                onClick={() => setActiveTab("output")}
              >
                Execution
                {activeTab === "output" && <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-blue-500 rounded-t-full shadow-[0_-4px_10px_rgba(59,130,246,0.5)]" />}
              </button>
            </div>

            <div className="flex-1 overflow-auto custom-scrollbar">
              <div className="p-12 space-y-20">
                {activeTab === "config" ? (
                  <div>

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
                          {Object.entries(props.node.props).map(([key, value]) => {
                            // Special handling for provider field
                            if (key === 'provider' && props.node?.nodeType === 'llm.model') {
                              return (
                                <div key={key} className="space-y-3">
                                  <div className="flex justify-between items-center px-1">
                                    <label className="holonLabel">{key}</label>
                                  </div>
                                  <div className="holonSelectWrapper flex gap-3">
                                    <CustomSelect
                                      options={availableProviders.map(p => ({ value: p, label: p.toUpperCase() }))}
                                      value={value as string}
                                      onChange={(v) => {
                                        props.onPatch?.(props.node!.id, { ...props.node!.props, provider: v });
                                      }}
                                      className="flex-1"
                                    />
                                    {props.onOpenCredentials && (
                                      <button
                                        type="button"
                                        onClick={() => props.onOpenCredentials!((value as string) || "openai")}
                                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-black/40 hover:bg-blue-500/20 text-blue-400/80 hover:text-blue-300 border border-white/10 hover:border-blue-500/50 transition-all"
                                        title="Configure Credentials"
                                      >
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            }
                            
                            // Special handling for model_name field
                            if (key === 'model_name' && props.node?.nodeType === 'llm.model') {
                              return (
                                <div key={key} className="space-y-3">
                                  <div className="flex justify-between items-center px-1">
                                    <label className="holonLabel">{key}</label>
                                  </div>
                                  <div className="holonSelectWrapper">
                                    <CustomSelect
                                      options={availableModels.map(model => ({ value: model.id, label: model.name }))}
                                      value={value as string}
                                      onChange={(v) => props.onPatch?.(props.node!.id, { ...props.node!.props, model_name: v })}
                                      placeholder={modelsStore.selectors.isLoading(currentProvider || '') ? 'Loading models…' : (availableModels.length ? 'Select model' : 'No models')}
                                      disabled={!currentProvider || modelsStore.selectors.isLoading(currentProvider || '') || availableModels.length === 0}
                                      className="w-full"
                                    />
                                  </div>
                                  {modelsStore.selectors.isLoading(currentProvider || '') && (
                                    <p className="text-[9px] text-blue-400/60 px-1">Fetching available models from API...</p>
                                  )}
                                  {modelsStore.selectors.getError(currentProvider || '') && (
                                    <p className="text-[9px] text-red-400/80 px-1">⚠ {modelsStore.selectors.getError(currentProvider || '')}</p>
                                  )}
                                </div>
                              );
                            }
                            
                            // Default handling for other properties
                            return (
                                <div key={key} className="space-y-3">
                                <div className="flex justify-between items-center px-1">
                                  <label className="holonLabel">{key}</label>
                                </div>
                                <textarea
                                  className="holonInput"
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
                            );
                          })}
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
                  </div>
                ) : (
                  <section className="space-y-8 h-full">
                    <h3 className="text-[11px] font-black uppercase tracking-[0.5em] text-white/10">Execution Output</h3>
                    <div className="rounded-[40px] bg-black/50 border border-white/5 h-full p-10 shadow-inner">
                      {props.executionOutput && props.executionOutput[props.node.id] ? (
                        <div className="space-y-6">
                          {/* Status Badge */}
                          <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                            {props.executionOutput[props.node.id].status === "error" ? (
                              <span className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-[0.2em] flex items-center gap-2">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="8" x2="12" y2="12" stroke="white" strokeWidth="2" strokeLinecap="round" />
                                  <line x1="12" y1="16" x2="12.01" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                                Error
                              </span>
                            ) : (
                              <span className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 text-[9px] font-black uppercase tracking-[0.2em]">
                                ✓ Executed
                              </span>
                            )}
                          </div>

                          {/* Error Display */}
                          {props.executionOutput[props.node.id].status === "error" && props.executionOutput[props.node.id].error ? (
                            <div className="space-y-6">
                              <div className="rounded-3xl bg-red-500/5 border-2 border-red-500/30 p-8 space-y-6">
                                <div className="flex items-start gap-4">
                                  <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400">
                                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                                      <line x1="12" y1="9" x2="12" y2="13" />
                                      <line x1="12" y1="17" x2="12.01" y2="17" />
                                    </svg>
                                  </div>
                                  <div className="flex-1 space-y-3">
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-red-400">
                                      {props.executionOutput[props.node.id].error_type || "Execution Error"}
                                    </div>
                                    <div className="text-[13px] leading-relaxed text-red-100/90 font-medium">
                                      {String(props.executionOutput[props.node.id].error)}
                                    </div>
                                  </div>
                                </div>

                                {/* Suggestion based on error type */}
                                {props.executionOutput[props.node.id].error_type === "AuthenticationError" && (
                                  <div className="pt-6 border-t border-red-500/20 space-y-4">
                                    <div className="text-[10px] font-black uppercase tracking-[0.3em] text-red-300/60">
                                      Suggested Action
                                    </div>
                                    <div className="text-[12px] leading-relaxed text-red-100/70">
                                      Configure your OpenAI API key in the credentials settings. Click the credentials button in the node configuration.
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <pre className="text-[12px] leading-6 text-blue-100/80 font-mono h-full overflow-auto custom-scrollbar">
                              {prettyJson(props.executionOutput[props.node.id])}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-6">
                          <div className="w-20 h-20 rounded-[30px] bg-white/5 flex items-center justify-center border border-white/5">
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                              <polyline points="7 10 12 15 17 10"></polyline>
                              <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                          </div>
                          <div className="space-y-2">
                            <p className="text-white/30 text-[10px] font-black uppercase tracking-[0.3em]">
                              No output available
                            </p>
                            <p className="text-white/10 text-[9px] font-medium max-w-[240px]">
                              Run the workflow to see execution results for this node
                            </p>
                          </div>
                        </div>
                      )}
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
