import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  ExternalLink,
  FileDown,
  FileClock,
  FileUp,
  Globe2,
  Keyboard,
  LayoutGrid,
  LockKeyhole,
  MessageSquareText,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TextQuote,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createId } from "../lib/id";
import { isTauri, nativeInvoke } from "../lib/platform";
import { PROVIDER_PRESETS, presetById } from "../lib/providers";
import {
  effectiveThinking,
  effortOptions,
  modelFamily,
  parametersFromProfile,
  sanitizeModelParameters,
  thinkingOptions,
  vendorParameterNote,
  webSearchSupport
} from "../lib/modelParameters";
import { beginWindowDrag } from "../lib/windowDrag";
import { defaultSettings, useAppStore } from "../store";
import type { ManagementSection, ModelParameters, PortableDataScope, PortableTransferResult, ProtocolKind, ProviderKind, ReasoningEffort } from "../types";
import { IconButton } from "../components/IconButton";

const IDENTITY_COLORS = [
  "#22c55e", "#3b82f6", "#2563eb", "#06b6d4", "#14b8a6", "#84cc16",
  "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#8b5cf6"
] as const;

const sections: Array<{ id: ManagementSection; label: string; icon: typeof Settings2 }> = [
  { id: "models", label: "模型与供应商", icon: SlidersHorizontal },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "layout", label: "布局", icon: LayoutGrid },
  { id: "conversation", label: "对话", icon: MessageSquareText },
  { id: "history", label: "会话历史", icon: FileClock },
  { id: "prompts", label: "提示词注入", icon: TextQuote },
  { id: "privacy", label: "数据与隐私", icon: ShieldCheck },
  { id: "shortcuts", label: "快捷键", icon: Keyboard },
  { id: "about", label: "关于", icon: Settings2 }
];

function configurationSnapshot(includeThreads = false) {
  const state = useAppStore.getState();
  return {
    accounts: state.accounts,
    profiles: state.profiles,
    columns: state.columns,
    rows: state.rows,
    columnWeights: state.columnWeights,
    rowWeights: state.rowWeights,
    autoLayout: state.autoLayout,
    composerSize: state.composerSize,
    selectedTargets: state.selectedTargets,
    onboardingVisible: state.onboardingVisible,
    promptTemplates: state.promptTemplates,
    settings: state.settings,
    ...(includeThreads ? { threads: state.threads } : {})
  };
}

async function flushConfiguration(includeThreads = false) {
  if (!isTauri()) return;
  const snapshot = configurationSnapshot(includeThreads);
  await nativeInvoke("save_app_snapshot", {
    snapshot,
    syncSnapshot: snapshot,
    broadcast: true,
    configurationOnly: true
  });
}

async function closeStandaloneSettings(includeThreads = false) {
  useAppStore.getState().setModelManagerRoute("list");
  await flushConfiguration(includeThreads);
  await nativeInvoke("hide_settings_window");
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div><label>{label}</label>{description ? <p>{description}</p> : null}</div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function SliderControl({ label, value, min, max, step = 1, unit = "", sample, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; sample?: React.ReactNode; onChange: (value: number) => void }) {
  return <div className="slider-control"><div className="slider-readout"><output>{value}{unit}</output>{sample ? <span className="slider-sample">{sample}</span> : null}</div><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></div>;
}

type NumberParameter = "temperature" | "topP" | "maxOutputTokens" | "thinkingBudget" | "topK" | "minP" | "frequencyPenalty";

function OptionalNumberField({ label, hint, field, value, min, max, step = 1, onChange }: {
  label: string;
  hint: string;
  field: NumberParameter;
  value?: number;
  min: number;
  max: number;
  step?: number;
  onChange: (field: NumberParameter, value?: number) => void;
}) {
  return <label><span>{label}</span><input type="number" inputMode="decimal" min={min} max={max} step={step} value={value ?? ""} placeholder="供应商默认" onChange={(event) => onChange(field, event.target.value === "" ? undefined : Number(event.target.value))} /><small>{hint}</small></label>;
}

function ModelManager() {
  const accounts = useAppStore((state) => state.accounts);
  const profiles = useAppStore((state) => state.profiles);
  const workspaceModelCount = profiles.filter((profile) => profile.enabled !== false).length;
  const mode = useAppStore((state) => state.modelManagerMode);
  const editingProfileId = useAppStore((state) => state.modelManagerProfileId);
  const addModel = useAppStore((state) => state.addModel);
  const removeModel = useAppStore((state) => state.removeModel);
  const setModelWorkspaceEnabled = useAppStore((state) => state.setModelWorkspaceEnabled);
  const updateModel = useAppStore((state) => state.updateModel);
  const updateAccount = useAppStore((state) => state.updateAccount);
  const setRoute = useAppStore((state) => state.setModelManagerRoute);
  const editingProfile = mode === "edit" ? profiles.find((profile) => profile.id === editingProfileId) : undefined;
  const editingAccount = editingProfile ? accounts.find((account) => account.id === editingProfile.accountId) : undefined;
  const [provider, setProvider] = useState<ProviderKind>("openai");
  const selected = presetById(provider)!;
  const [alias, setAlias] = useState(selected.name);
  const [baseUrl, setBaseUrl] = useState(selected.baseUrl);
  const [protocol, setProtocol] = useState<ProtocolKind>(selected.protocol);
  const [auth, setAuth] = useState<"bearer" | "api-key">(selected.auth);
  const [color, setColor] = useState(selected.color);
  const [modelId, setModelId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [secret, setSecret] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<string>();
  const [workspaceNotice, setWorkspaceNotice] = useState<string>();
  const [parameters, setParameters] = useState<ModelParameters>({ thinkingMode: "provider_default" });

  useEffect(() => {
    if (mode === "edit" && editingProfile && editingAccount) {
      setProvider(editingProfile.provider);
      setAlias(editingAccount.alias);
      setBaseUrl(editingAccount.baseUrl);
      setProtocol(editingAccount.protocol);
      setAuth(editingAccount.auth);
      setColor(editingProfile.color);
      setModelId(editingProfile.remoteModelId);
      setDisplayName(editingProfile.displayName);
      setParameters(parametersFromProfile(editingProfile));
      setSecret("");
      setTestResult(undefined);
      return;
    }
    if (mode === "add") {
      const preset = presetById("openai")!;
      setProvider("openai");
      setAlias(preset.name);
      setBaseUrl(preset.baseUrl);
      setProtocol(preset.protocol);
      setAuth(preset.auth);
      setColor(preset.color);
      setModelId("");
      setDisplayName("");
      setParameters({ thinkingMode: "provider_default" });
      setSecret("");
      setTestResult(undefined);
    }
  }, [editingAccount, editingProfile, mode]);

  const chooseProvider = (id: ProviderKind) => {
    const preset = presetById(id)!;
    setProvider(id);
    setAlias(preset.name);
    setBaseUrl(preset.baseUrl);
    setProtocol(preset.protocol);
    setAuth(preset.auth);
    setColor(preset.color);
    setParameters({ thinkingMode: "provider_default" });
    setTestResult(undefined);
  };

  const openDocs = async () => {
    if (!selected.docsUrl) return;
    if (isTauri()) await openUrl(selected.docsUrl);
    else window.open(selected.docsUrl, "_blank", "noopener,noreferrer");
  };

  const save = async () => {
    const editing = mode === "edit" && editingProfile && editingAccount;
    if (!alias.trim() || !baseUrl.trim() || !modelId.trim() || (!editing && !secret.trim()) || (editing && !editingAccount.secretConfigured && !secret.trim())) {
      setTestResult(editing && editingAccount.secretConfigured ? "请完整填写账号、地址与模型 ID。" : "请完整填写账号、地址、API Key 与模型 ID。");
      return;
    }
    setSaving(true);
    const accountId = editing ? editingAccount.id : createId("account");
    const profileId = editing ? editingProfile.id : createId("profile");
    const account = {
      id: accountId,
      presetId: provider,
      alias: alias.trim(),
      baseUrl: baseUrl.trim().replace(/\/$/, ""),
      protocol,
      auth,
      secretConfigured: editing ? editingAccount.secretConfigured || Boolean(secret.trim()) : true
    } as const;
    const safeParameters = sanitizeModelParameters(provider, modelId, parameters, protocol);
    const profile = {
      id: profileId,
      accountId,
      provider,
      providerName: editing ? editingProfile.providerName : selected.name,
      remoteModelId: modelId.trim(),
      displayName: displayName.trim() || modelId.trim(),
      color,
      enabled: true,
      capabilities: { images: "unknown", reasoning: "unknown" },
      reasoningEnabled: effectiveThinking(provider, modelId, safeParameters),
      reasoningEffort: safeParameters.reasoningEffort ?? "medium",
      parameters: safeParameters
    } as const;
    try {
      if (editing) {
        await nativeInvoke("update_provider_account", { account, profile, secret: secret.trim() || null });
        updateAccount(account.id, account);
        updateModel(profile.id, profile);
        setRoute("list");
      } else {
        await nativeInvoke("save_provider_account", { account, profile, secret });
        addModel(account, profile);
      }
      setSecret("");
      setModelId("");
      setDisplayName("");
      if (!editing) setRoute("list");
      if (!editing && isTauri()) await closeStandaloneSettings();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  if (mode === "edit" && (!editingProfile || !editingAccount)) {
    return <div className="settings-page"><div className="settings-empty"><LockKeyhole size={24} /><h3>找不到这个模型</h3><p>它可能已在另一个窗口中被删除。</p><button type="button" className="secondary-button" onClick={() => setRoute("list")}>返回模型列表</button></div></div>;
  }

  if (mode === "add" || mode === "edit") {
    const editing = mode === "edit";
    const family = modelFamily(provider, modelId);
    const modeChoices = thinkingOptions(family);
    const efforts = effortOptions(family);
    const safeParameters = sanitizeModelParameters(provider, modelId, parameters, protocol);
    const searchSupport = webSearchSupport(provider, modelId, protocol);
    const updateNumber = (field: NumberParameter, value?: number) => setParameters((current) => ({ ...current, [field]: value }));
    return (
      <div className={`add-model-flow ${editing ? "is-editing" : "is-adding"}`}>
        {!editing ? <div className="provider-choices" role="list" aria-label="供应商">
          {PROVIDER_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className={provider === preset.id ? "selected" : ""} onClick={() => chooseProvider(preset.id)}>
              <span className="provider-dot" style={{ background: preset.color }} />
              <span>{preset.name}</span>
              {provider === preset.id ? <Check size={14} /> : <ChevronRight size={14} />}
            </button>
          ))}
        </div> : null}
        <form className="model-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <div className="section-heading">
            <div><h2>{editing ? `编辑 ${editingProfile?.displayName}` : `添加 ${selected.name} 模型`}</h2><p>{editing ? "保留 API Key 输入为空即可继续使用现有凭据；填写新值会安全替换。" : "密钥保存后不可重新显示，只能替换或清除。"}</p></div>
            <button type="button" className="text-button" disabled={!selected.docsUrl} onClick={openDocs}>官方文档 <ExternalLink size={13} /></button>
          </div>
          <div className="form-grid">
            <label><span>账号别名</span><input value={alias} onChange={(event) => setAlias(event.target.value)} /></label>
            <label><span>API Key</span><input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={editing ? "留空以保留现有 Key" : "只写入 Windows Credential Manager"} /></label>
            <label className="span-2"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label>
            <label><span>协议</span><select value={protocol} onChange={(event) => setProtocol(event.target.value as ProtocolKind)}><option value="responses">Responses-compatible</option><option value="chat_completions">Chat Completions-compatible</option></select></label>
            <label><span>认证方式</span><select value={auth} onChange={(event) => setAuth(event.target.value as "bearer" | "api-key")}><option value="bearer">Authorization: Bearer</option><option value="api-key">api-key 请求头</option></select></label>
            <label><span>模型 ID</span><input value={modelId} disabled={editing} onChange={(event) => setModelId(event.target.value)} placeholder="手工填写，不硬编码最新模型" /></label>
            <label className="span-2"><span>显示名（可选）</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="默认使用模型 ID" /></label>
            <div className="model-identity-row span-2">
              <label><span>思考模式</span><select value={safeParameters.thinkingMode ?? modeChoices[0].value} disabled={modeChoices.length === 1} onChange={(event) => setParameters((current) => ({ ...current, thinkingMode: event.target.value as ModelParameters["thinkingMode"] }))}>{modeChoices.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label><span>思考强度</span><select value={safeParameters.reasoningEffort ?? "provider_default"} disabled={!effectiveThinking(provider, modelId, safeParameters) || !["deepseek", "kimi-k3", "siliconflow", "generic"].includes(family)} onChange={(event) => setParameters((current) => ({ ...current, reasoningEffort: event.target.value === "provider_default" ? undefined : event.target.value as ReasoningEffort }))}><option value="provider_default">供应商默认</option>{efforts.map((effort) => <option key={effort} value={effort}>{effort === "low" ? "低" : effort === "medium" ? "中" : effort === "high" ? "高" : "最高"}</option>)}</select></label>
              <div className="identity-color-field"><span>身份颜色</span><details className="identity-color-select"><summary aria-label="展开身份颜色选择"><i style={{ background: color }} /><code>{color.toUpperCase()}</code><ChevronDown size={14} /></summary><div className="identity-palette" role="listbox" aria-label="身份标准色盘">{IDENTITY_COLORS.map((item) => <button key={item} type="button" role="option" className={color.toLowerCase() === item ? "selected" : ""} style={{ background: item }} aria-label={`选择身份颜色 ${item}`} aria-selected={color.toLowerCase() === item} onClick={(event) => { setColor(item); event.currentTarget.closest("details")?.removeAttribute("open"); }} />)}<label className="custom-color-chip" title="自定义身份颜色"><input aria-label="自定义身份颜色" type="color" value={color.startsWith("#") ? color : "#3b82f6"} onChange={(event) => { setColor(event.target.value); event.currentTarget.closest("details")?.removeAttribute("open"); }} /><span style={{ background: color }} /></label></div></details></div>
            </div>
            <section className="web-search-setting span-2" aria-labelledby="web-search-title">
              <div><span id="web-search-title"><Globe2 size={14} /> 联网搜索</span><strong>{searchSupport.label}</strong><small>{searchSupport.detail}</small></div>
              <button type="button" role="switch" aria-label="联网搜索" aria-checked={Boolean(safeParameters.webSearchEnabled)} disabled={searchSupport.capability !== "supported"} className={`switch ${safeParameters.webSearchEnabled ? "on" : ""}`} onClick={() => setParameters((current) => ({ ...current, webSearchEnabled: !safeParameters.webSearchEnabled, ...(searchSupport.disablesThinking && !safeParameters.webSearchEnabled ? { thinkingMode: "disabled" as const } : {}) }))}><span /></button>
            </section>
            <section className="vendor-parameters span-2" aria-labelledby="vendor-parameters-title">
              <div className="vendor-parameters-heading"><div><h3 id="vendor-parameters-title">{selected.name} 专属生成参数</h3><p>{vendorParameterNote(family)}</p></div><span>留空 = 不发送</span></div>
              <div className="vendor-parameter-grid">
                {(family === "minimax-m3" || family === "minimax-m2" || family === "minimax-unknown") ? <>
                  <label><span>服务层级</span><select value={safeParameters.serviceTier ?? "provider_default"} onChange={(event) => setParameters((current) => ({ ...current, serviceTier: event.target.value as ModelParameters["serviceTier"] }))}><option value="provider_default">供应商默认（standard）</option><option value="standard">standard</option><option value="priority">priority（1.5× 价格）</option></select><small>priority 更快准入，但官方定价为 standard 的 1.5 倍。</small></label>
                  <label><span>思考内容分离</span><button type="button" role="switch" aria-checked={safeParameters.reasoningSplit ?? true} className={`switch ${safeParameters.reasoningSplit ?? true ? "on" : ""}`} onClick={() => setParameters((current) => ({ ...current, reasoningSplit: !(safeParameters.reasoningSplit ?? true) }))}><span /></button><small>分离到 reasoning_content，便于折叠显示。</small></label>
                  <OptionalNumberField label="最大生成 Token" hint={family === "minimax-m3" ? "max_completion_tokens；上限 524288。" : "max_completion_tokens；上限 204800。"} field="maxOutputTokens" value={safeParameters.maxOutputTokens} min={1} max={family === "minimax-m3" ? 524288 : 204800} onChange={updateNumber} />
                  <OptionalNumberField label="Temperature" hint="0–2；仅在需要覆盖默认值时填写。" field="temperature" value={safeParameters.temperature} min={0} max={2} step={0.01} onChange={updateNumber} />
                  <OptionalNumberField label="Top P" hint={`0–1；${family === "minimax-m3" ? "M3 默认 0.95" : "M2.x 默认 0.9"}。`} field="topP" value={safeParameters.topP} min={0} max={1} step={0.01} onChange={updateNumber} />
                </> : null}
                {family === "kimi-k26" ? <label><span>保留式思考</span><select value={safeParameters.thinkingKeep ?? "provider_default"} onChange={(event) => setParameters((current) => ({ ...current, thinkingKeep: event.target.value as ModelParameters["thinkingKeep"] }))}><option value="provider_default">供应商默认（不保留）</option><option value="none">不保留历史推理</option><option value="all">保留全部推理</option></select><small>选择“全部”后，多轮上下文会回传同模型 reasoning_content。</small></label> : null}
                {["deepseek", "kimi-k3", "kimi-k27-code", "kimi-k26", "kimi-unknown"].includes(family) ? <OptionalNumberField label="最大输出 Token" hint={family.startsWith("kimi") ? "Kimi 使用 max_tokens；思考与正文共同占用。" : "使用 max_tokens；留空沿用 DeepSeek 默认。"} field="maxOutputTokens" value={safeParameters.maxOutputTokens} min={1} max={1048576} onChange={updateNumber} /> : null}
                {family === "siliconflow" ? <>
                  <OptionalNumberField label="最大回答 Token" hint="max_tokens，不包含思考链；建议为上下文预留约 10K。" field="maxOutputTokens" value={safeParameters.maxOutputTokens} min={1} max={1048576} onChange={updateNumber} />
                  <OptionalNumberField label="思考预算" hint="thinking_budget；官方范围 128–32768。" field="thinkingBudget" value={safeParameters.thinkingBudget} min={128} max={32768} onChange={updateNumber} />
                  <OptionalNumberField label="Temperature" hint="0–2；通常与 Top P 二选一调整。" field="temperature" value={safeParameters.temperature} min={0} max={2} step={0.01} onChange={updateNumber} />
                  <OptionalNumberField label="Top P" hint="0–1；核采样概率质量。" field="topP" value={safeParameters.topP} min={0} max={1} step={0.01} onChange={updateNumber} />
                  <OptionalNumberField label="Top K" hint="0–100；供应商未支持的模型可能忽略或拒绝。" field="topK" value={safeParameters.topK} min={0} max={100} step={1} onChange={updateNumber} />
                  <OptionalNumberField label="Min P" hint="0–1；仅 Qwen3 等支持模型使用。" field="minP" value={safeParameters.minP} min={0} max={1} step={0.01} onChange={updateNumber} />
                  <OptionalNumberField label="频率惩罚" hint="-2–2；正值降低重复倾向。" field="frequencyPenalty" value={safeParameters.frequencyPenalty} min={-2} max={2} step={0.01} onChange={updateNumber} />
                </> : null}
                {family === "generic" ? <>
                  <OptionalNumberField label="最大输出 Token" hint={protocol === "responses" ? "发送为 max_output_tokens。" : "发送为 max_tokens。"} field="maxOutputTokens" value={safeParameters.maxOutputTokens} min={1} max={1048576} onChange={updateNumber} />
                  <OptionalNumberField label="Temperature" hint="0–2；模型不支持时请留空。" field="temperature" value={safeParameters.temperature} min={0} max={2} step={0.01} onChange={updateNumber} />
                  <OptionalNumberField label="Top P" hint="0–1；模型不支持时请留空。" field="topP" value={safeParameters.topP} min={0} max={1} step={0.01} onChange={updateNumber} />
                </> : null}
              </div>
            </section>
          </div>
          {testResult ? <div className="form-feedback" role="status">{testResult}</div> : null}
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={() => setRoute("list")}>取消</button>
            <button type="button" className="secondary-button" disabled={testing || !secret || !baseUrl} onClick={async () => {
              setTesting(true);
              try {
                const result = await nativeInvoke<string>("test_provider", { baseUrl, protocol, auth, secret });
                setTestResult(result ?? "浏览器模式：配置格式有效；真实连接测试只在桌面版运行。");
              } catch (error) {
                setTestResult(`连接失败：${String(error)}`);
              } finally {
                setTesting(false);
              }
            }}>{testing ? "正在测试…" : "认证测试"}</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? "正在保存…" : editing ? "保存模型设置" : workspaceModelCount >= 17 ? "保存模型配置" : "保存并加入工作区"}</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="section-heading">
        <div><h2>模型与供应商</h2><p>{accounts.length} 个账号 · {workspaceModelCount}/17 个已显示 · {profiles.length} 个已配置</p></div>
        <button type="button" className="primary-button" onClick={() => setRoute("add")}><Plus size={15} /> 添加模型</button>
      </div>
      {workspaceNotice ? <div className="inline-setting-notice" role="status">{workspaceNotice}</div> : null}
      {profiles.length === 0 ? (
        <div className="settings-empty"><LockKeyhole size={24} /><h3>还没有模型</h3><p>添加 API 账号后，模型会出现在当前工作区的空位中。</p></div>
      ) : (
        <div className="model-list">
          {profiles.map((profile) => {
            const account = accounts.find((item) => item.id === profile.accountId);
            const profileParameters = sanitizeModelParameters(profile.provider, profile.remoteModelId, parametersFromProfile(profile), account?.protocol);
            const profileFamily = modelFamily(profile.provider, profile.remoteModelId);
            const profileThinking = effectiveThinking(profile.provider, profile.remoteModelId, profileParameters, profile.reasoningEnabled);
            const canToggleThinking = thinkingOptions(profileFamily).some((item) => item.value === "disabled");
            const profileEfforts = effortOptions(profileFamily);
            const profileSearch = webSearchSupport(profile.provider, profile.remoteModelId, account?.protocol);
            return (
              <div className={`model-row ${profile.enabled === false ? "is-workspace-hidden" : ""}`} key={profile.id}>
                <label className="workspace-model-check" title={profile.enabled === false ? "勾选后显示在主工作区" : "取消勾选后隐藏窗格；配置和历史仍保留"}>
                  <input
                    type="checkbox"
                    checked={profile.enabled !== false}
                    aria-label={`${profile.displayName} 在工作区显示`}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      const changed = setModelWorkspaceEnabled(profile.id, enabled);
                      setWorkspaceNotice(changed
                        ? enabled ? `已将 ${profile.displayName} 显示在工作区` : `已隐藏 ${profile.displayName}；配置与历史仍保留`
                        : "工作区最多同时显示 17 个模型，请先取消勾选其他模型。");
                    }}
                  />
                </label>
                <span className="provider-dot" style={{ background: profile.color }} />
                <div><strong>{profile.displayName}</strong><span>{profile.providerName} · {account?.alias}</span></div>
                <code>{profile.remoteModelId}</code>
                <div className="model-reasoning">
                  <BrainCircuit size={14} />
                  <button type="button" role="switch" aria-label={`${profile.displayName} 思考模式`} aria-checked={profileThinking} disabled={!canToggleThinking} className={`switch ${profileThinking ? "on" : ""}`} onClick={() => { const next = profileThinking ? "disabled" : "enabled"; updateModel(profile.id, { reasoningEnabled: !profileThinking, parameters: { ...profileParameters, thinkingMode: next } }); }}><span /></button>
                  <select aria-label={`${profile.displayName} 思考强度`} value={profileParameters.reasoningEffort ?? "provider_default"} disabled={!profileThinking || !["deepseek", "kimi-k3", "siliconflow", "generic"].includes(profileFamily)} onChange={(event) => { const value = event.target.value === "provider_default" ? undefined : event.target.value as ReasoningEffort; updateModel(profile.id, { reasoningEffort: value ?? "medium", parameters: { ...profileParameters, reasoningEffort: value } }); }}><option value="provider_default">默认</option>{profileEfforts.map((effort) => <option key={effort} value={effort}>{effort === "max" ? "最高" : effort === "high" ? "高" : effort === "medium" ? "中" : "低"}</option>)}</select>
                </div>
                <div className="model-web-search" title={profileSearch.detail}>
                  <Globe2 size={14} />
                  <button type="button" role="switch" aria-label={`${profile.displayName} 联网搜索`} aria-checked={Boolean(profileParameters.webSearchEnabled)} disabled={profileSearch.capability !== "supported"} className={`switch ${profileParameters.webSearchEnabled ? "on" : ""}`} onClick={() => { const enabled = !profileParameters.webSearchEnabled; const nextParameters = sanitizeModelParameters(profile.provider, profile.remoteModelId, { ...profileParameters, webSearchEnabled: enabled, ...(enabled && profileSearch.disablesThinking ? { thinkingMode: "disabled" as const } : {}) }, account?.protocol); updateModel(profile.id, { reasoningEnabled: effectiveThinking(profile.provider, profile.remoteModelId, nextParameters), parameters: nextParameters }); }}><span /></button>
                </div>
                <span className={`configured-key ${account?.secretConfigured ? "" : "needs-key"}`}><LockKeyhole size={13} /> {account?.secretConfigured ? "Key 已配置" : "Key 待配置"}</span>
                <IconButton label="编辑模型设置" onClick={() => setRoute("edit", profile.id)}><Settings2 size={14} /></IconButton>
                <IconButton label="删除模型配置" danger onClick={() => { if (window.confirm(`删除 ${profile.displayName} 的模型配置？已归档历史仍会保留身份信息。`)) removeModel(profile.id); }}><Trash2 size={14} /></IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function relativeLuminance(hex: string) {
  const channel = (offset: number) => {
    const encoded = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4;
  };
  return .2126 * channel(1) + .7152 * channel(3) + .0722 * channel(5);
}

function contrastRatio(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

function AppearanceSettings() {
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  const themes = [
    ["black", "纯黑"], ["white", "纯白"], ["light-gray", "浅灰"], ["dark-gray", "深灰"], ["light-blue", "浅蓝"], ["light-green", "浅绿"], ["custom", "自定义"]
  ] as const;
  const customContrast = contrastRatio(settings.customTextColor, settings.customBackgroundColor);
  const repairedTextColor = contrastRatio("#ffffff", settings.customBackgroundColor) >= contrastRatio("#000000", settings.customBackgroundColor) ? "#ffffff" : "#000000";
  const restoreAppearance = () => update({
    theme: defaultSettings.theme,
    backgroundOpacity: defaultSettings.backgroundOpacity,
    textOpacity: defaultSettings.textOpacity,
    uiFontSize: defaultSettings.uiFontSize,
    conversationFontSize: defaultSettings.conversationFontSize,
    conversationLineHeight: defaultSettings.conversationLineHeight,
    messageSpacing: defaultSettings.messageSpacing,
    windowRadius: defaultSettings.windowRadius,
    paneRadius: defaultSettings.paneRadius,
    customBackgroundColor: defaultSettings.customBackgroundColor,
    customTextColor: defaultSettings.customTextColor,
    reducedMotion: defaultSettings.reducedMotion
  });
  return (
    <div className="settings-page">
      <div className="section-heading"><div><h2>外观</h2><p>设置会实时同步到旁边的工作窗口。</p></div><button type="button" className="secondary-button" onClick={restoreAppearance}><RotateCcw size={14} /> 恢复默认</button></div>
      <SettingRow label="主题" description="切换色彩，不改变布局。">
        <div className="theme-picker">{themes.map(([id, label]) => <button key={id} type="button" aria-label={`主题：${label}`} aria-pressed={settings.theme === id} data-label={label} className={`theme-swatch theme-${id} ${settings.theme === id ? "selected" : ""}`} onClick={() => update({ theme: id })}><span aria-hidden="true" /></button>)}</div>
      </SettingRow>
      {settings.theme === "custom" ? <>
        <SettingRow label="自定义背景色" description="自动派生窗格、悬停、边框和分割线。"><label className="color-control"><input aria-label="自定义背景色" type="color" value={settings.customBackgroundColor} onChange={(event) => update({ customBackgroundColor: event.target.value })} /><code>{settings.customBackgroundColor}</code></label></SettingRow>
        <SettingRow label="自定义文字色" description="建议与背景保持至少 4.5:1 对比度。"><label className="color-control"><input aria-label="自定义文字色" type="color" value={settings.customTextColor} onChange={(event) => update({ customTextColor: event.target.value })} /><code>{settings.customTextColor}</code></label></SettingRow>
        <SettingRow label="可读性检查" description={customContrast >= 4.5 ? "达到普通正文 WCAG AA 建议值。" : "当前组合低于 4.5:1，长文本可能难以辨认。"}>
          <div className={`contrast-check ${customContrast < 4.5 ? "is-warning" : ""}`} role="status">
            <strong>{customContrast.toFixed(2)}:1</strong>
            {customContrast < 4.5 ? <button type="button" className="secondary-button" onClick={() => update({ customTextColor: repairedTextColor })}>一键修复</button> : <span>对比清晰</span>}
          </div>
        </SettingRow>
      </> : null}
      <SettingRow label="背景透明度" description="控制画布、窗格、输入和代码表面。"><SliderControl label="背景透明度" value={settings.backgroundOpacity} min={0} max={100} unit="%" onChange={(backgroundOpacity) => update({ backgroundOpacity })} /></SettingRow>
      <SettingRow label="文字透明度" description="只影响文字和随文字着色的图标，不连带背景。"><SliderControl label="文字透明度" value={settings.textOpacity} min={0} max={100} unit="%" onChange={(textOpacity) => update({ textOpacity })} /></SettingRow>
      <SettingRow label="UI 字号" description="全软件控件、标题、说明和状态文字统一缩放。"><SliderControl label="UI 字号" value={settings.uiFontSize} min={5} max={30} step={0.5} unit="px" sample={<span style={{ fontSize: settings.uiFontSize }}>Aa 界面预览</span>} onChange={(uiFontSize) => update({ uiFontSize })} /></SettingRow>
      <SettingRow label="会话正文字号" description="仅调整用户消息、AI 回答和代码正文。"><SliderControl label="会话正文字号" value={settings.conversationFontSize} min={5} max={30} step={0.5} unit="px" sample={<span style={{ fontSize: settings.conversationFontSize }}>正文 Aa 123</span>} onChange={(conversationFontSize) => update({ conversationFontSize })} /></SettingRow>
      <SettingRow label="正文行间距" description="调节长回答的阅读松紧度。"><SliderControl label="正文行间距" value={settings.conversationLineHeight} min={1.1} max={2.2} step={0.02} onChange={(conversationLineHeight) => update({ conversationLineHeight })} /></SettingRow>
      <SettingRow label="消息间距" description="每条消息内容区上下留白，数值越小越紧凑。"><SliderControl label="消息间距" value={settings.messageSpacing} min={4} max={32} step={1} unit="px" onChange={(messageSpacing) => update({ messageSpacing })} /></SettingRow>
      <SettingRow label="主窗口圆角" description="独立于内部小窗格。"><SliderControl label="主窗口圆角" value={settings.windowRadius} min={0} max={30} unit=" DIP" onChange={(windowRadius) => update({ windowRadius })} /></SettingRow>
      <SettingRow label="小窗格圆角" description="对会话窗、空位和输入窗生效。"><SliderControl label="小窗格圆角" value={settings.paneRadius} min={0} max={30} unit=" DIP" onChange={(paneRadius) => update({ paneRadius })} /></SettingRow>
      <SettingRow label="减少动态" description="停用吸附和状态变化中的位移动画。"><button type="button" role="switch" aria-label="减少动态" aria-checked={settings.reducedMotion} className={`switch ${settings.reducedMotion ? "on" : ""}`} onClick={() => update({ reducedMotion: !settings.reducedMotion })}><span /></button></SettingRow>
      <div className="appearance-preview" aria-label="A 风格实时预览"><div /><div /><div /><div /><div /><div className="preview-composer" /></div>
    </div>
  );
}

function LayoutSettings() {
  const columns = useAppStore((state) => state.columns);
  const rows = useAppStore((state) => state.rows);
  const auto = useAppStore((state) => state.autoLayout);
  const setGrid = useAppStore((state) => state.setGrid);
  const setAuto = useAppStore((state) => state.setAutoLayout);
  const size = useAppStore((state) => state.composerSize);
  const configuredProfiles = useAppStore((state) => state.profiles);
  const requiredCells = Math.max(2, configuredProfiles.filter((profile) => profile.enabled !== false).length + 1);
  const setSize = useAppStore((state) => state.setComposerSize);
  return (
    <div className="settings-page">
      <div className="section-heading"><div><h2>布局</h2><p>默认 2×1：一个模型位与一个输入窗；最多 6×3。</p></div><button type="button" className="secondary-button" onClick={() => { setAuto(true); setSize("normal"); }}><RotateCcw size={14} /> 恢复自动布局</button></div>
      <SettingRow label="自动布局" description="新增模型时选择最近可容纳布局，并保留阅读顺序。"><button type="button" role="switch" aria-label="自动布局" aria-checked={auto} className={`switch ${auto ? "on" : ""}`} onClick={() => setAuto(!auto)}><span /></button></SettingRow>
      <SettingRow label="列数" description="一行最多 6 个完整窗格；空间不足时会自动增加行数。"><div className="segmented">{[1,2,3,4,5,6].map((value) => <button type="button" key={value} aria-pressed={columns === value} disabled={value * 3 < requiredCells} className={columns === value ? "selected" : ""} onClick={() => setGrid(value, Math.max(rows, Math.ceil(requiredCells / value)))}>{value}</button>)}</div></SettingRow>
      <SettingRow label="行数" description="最多 3 行；空间不足时会自动增加列数。"><div className="segmented">{[1,2,3].map((value) => <button type="button" key={value} aria-pressed={rows === value} disabled={value * 6 < requiredCells} className={rows === value ? "selected" : ""} onClick={() => setGrid(Math.max(columns, Math.ceil(requiredCells / value)), value)}>{value}</button>)}</div></SettingRow>
      <SettingRow label="输入窗默认状态"><div className="segmented">{(["compact", "normal", "expanded"] as const).map((value) => <button type="button" key={value} aria-pressed={size === value} className={size === value ? "selected" : ""} onClick={() => setSize(value)}>{value === "compact" ? "紧凑" : value === "normal" ? "正常" : "扩展"}</button>)}</div></SettingRow>
      <div className="constraint-note"><LayoutGrid size={17} /><div><strong>约束 solver 已启用</strong><p>锁定窗格不参与自动尺寸分配；无解时会阻止继续缩小，而不是让窗格重叠。</p></div></div>
    </div>
  );
}

function ConversationSettings() {
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  return (
    <div className="settings-page">
      <div className="section-heading"><div><h2>对话</h2><p>默认关闭上下文；每个模型只使用自己的线程。</p></div></div>
      <SettingRow label="默认连接上下文" description="只影响新建会话；每个模型仍只接收自己的历史。"><button type="button" role="switch" aria-label="默认连接上下文" aria-checked={settings.defaultContextEnabled} className={`switch ${settings.defaultContextEnabled ? "on" : ""}`} onClick={() => update({ defaultContextEnabled: !settings.defaultContextEnabled })}><span /></button></SettingRow>
      <SettingRow label="发送快捷键" description="输入法组合期间不会误发送。"><kbd>Enter</kbd><span className="control-separator">换行</span><kbd>Shift + Enter</kbd></SettingRow>
      <SettingRow label="中断回答进入上下文" description="开启后会把已有的不完整回答也纳入同模型下一轮。"><button type="button" role="switch" aria-label="中断回答进入上下文" aria-checked={settings.includeInterruptedInContext} className={`switch ${settings.includeInterruptedInContext ? "on" : ""}`} onClick={() => update({ includeInterruptedInContext: !settings.includeInterruptedInContext })}><span /></button></SettingRow>
      <SettingRow label="队列策略" description="自动会在当前批次结束后继续；手动则保持暂停。"><div className="segmented"><button type="button" aria-pressed={settings.queueStrategy === "automatic"} className={settings.queueStrategy === "automatic" ? "selected" : ""} onClick={() => update({ queueStrategy: "automatic" })}>自动继续</button><button type="button" aria-pressed={settings.queueStrategy === "manual"} className={settings.queueStrategy === "manual" ? "selected" : ""} onClick={() => update({ queueStrategy: "manual" })}>手动恢复</button></div></SettingRow>
    </div>
  );
}

function PromptSettings() {
  const templates = useAppStore((state) => state.promptTemplates);
  const settings = useAppStore((state) => state.settings);
  const update = useAppStore((state) => state.updateSettings);
  const saveTemplate = useAppStore((state) => state.savePromptTemplate);
  const removeTemplate = useAppStore((state) => state.removePromptTemplate);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const save = () => {
    if (!name.trim() || !content.trim()) return;
    const id = createId("prompt");
    saveTemplate({ id, name: name.trim(), content: content.trim(), enabled: true, createdAt: new Date().toISOString() });
    update({ activePromptId: id, promptInjectionEnabled: true });
    setName(""); setContent("");
  };
  return <div className="settings-page prompt-settings">
    <div className="section-heading"><div><h2>提示词注入</h2><p>选中的前缀会在发送时加入每个目标模型，不改写工作区里显示的原始问题。</p></div></div>
    <SettingRow label="启用提示词前缀" description="关闭后保留模板，但发送时不注入。"><button type="button" role="switch" aria-label="启用提示词前缀" aria-checked={settings.promptInjectionEnabled} className={`switch ${settings.promptInjectionEnabled ? "on" : ""}`} onClick={() => update({ promptInjectionEnabled: !settings.promptInjectionEnabled })}><span /></button></SettingRow>
    <div className="prompt-editor"><label><span>模板名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：代码审查" /></label><label><span>前缀提示词</span><textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="每次发送前注入的指令…" /></label><button type="button" className="primary-button" disabled={!name.trim() || !content.trim()} onClick={save}>保存并启用</button></div>
    <div className="prompt-list">{templates.length === 0 ? <div className="settings-empty"><TextQuote size={24} /><h3>还没有提示词模板</h3><p>创建模板后可随时切换，不需要反复复制粘贴。</p></div> : templates.map((template) => <div className={`prompt-row ${settings.activePromptId === template.id ? "active" : ""}`} key={template.id}><button type="button" className="prompt-select" onClick={() => update({ activePromptId: template.id, promptInjectionEnabled: true })}><TextQuote size={15} /><span><strong>{template.name}</strong><small>{template.content}</small></span></button><IconButton label="删除提示词" danger onClick={() => removeTemplate(template.id)}><Trash2 size={14} /></IconButton></div>)}</div>
  </div>;
}

function PrivacySettings() {
  const resetAllData = useAppStore((state) => state.resetAllData);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [importScope, setImportScope] = useState<PortableDataScope>("all");
  const importRef = useRef<HTMLInputElement>(null);
  const scopeLabel: Record<PortableDataScope, string> = { configuration: "软件配置", data: "会话数据", all: "配置与数据" };

  const exportDiagnostics = async () => {
    try {
      const path = await nativeInvoke<string>("export_diagnostics");
      setNotice(path ? `已导出：${path}` : "浏览器预览模式不写入诊断文件");
    } catch (error) {
      setNotice(String(error));
    }
  };

  const exportPortable = async (scope: PortableDataScope) => {
    setBusy(`export-${scope}`);
    try {
      await flushConfiguration();
      const result = await nativeInvoke<PortableTransferResult>("export_portable_data", { scope });
      if (!result?.path) {
        setNotice("浏览器预览模式不写入迁移文件；请在桌面版中使用导出。");
        return;
      }
      setNotice(`已导出${scopeLabel[scope]}：${result.profileCount} 个模型、${result.sessionCount} 个历史会话、${result.attachmentCount} 个附件。API Key 未包含在文件中。`);
      await revealItemInDir(result.path);
    } catch (error) {
      setNotice(`导出失败：${String(error)}`);
    } finally {
      setBusy(undefined);
    }
  };

  const chooseImport = (scope: PortableDataScope) => {
    setImportScope(scope);
    importRef.current?.click();
  };

  const importPortable = async (file?: File) => {
    if (!file) return;
    const confirmed = window.confirm(`导入“${scopeLabel[importScope]}”将覆盖对应范围的本机内容；未选择的范围保持不变。继续吗？\n\nAPI Key 不会从迁移文件导入，模型账号需要重新填写 Key。`);
    if (!confirmed) return;
    setBusy(`import-${importScope}`);
    try {
      if (!isTauri()) {
        JSON.parse(await file.text());
        setNotice("文件结构可读取；真实导入只在桌面版执行。");
        return;
      }
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const result = await nativeInvoke<PortableTransferResult>("import_portable_data", { bytes, scope: importScope });
      setNotice(`已导入${scopeLabel[importScope]}：${result?.profileCount ?? 0} 个模型、${result?.sessionCount ?? 0} 个历史会话、${result?.attachmentCount ?? 0} 个附件。所有队列均已暂停。`);
    } catch (error) {
      setNotice(`导入失败：${String(error)}`);
    } finally {
      setBusy(undefined);
      if (importRef.current) importRef.current.value = "";
    }
  };

  const clearData = async () => {
    if (!window.confirm("确定清空 AiPin 的本机历史、设置、附件与所有已保存 API Key？此操作无法撤销。")) return;
    try {
      await nativeInvoke("clear_all_data");
      resetAllData();
      localStorage.removeItem("aipin-ui-snapshot-v1");
      setNotice("本机数据已清空");
    } catch (error) {
      setNotice(String(error));
    }
  };

  return (
    <div className="settings-page">
      <div className="section-heading"><div><h2>数据与隐私</h2><p>没有 AiPin 云端账号、遥测或中转服务器。</p></div></div>
      <div className="privacy-banner"><ShieldCheck size={20} /><div><strong>API Key 与会话分离保存</strong><p>Key 位于 Windows Credential Manager；SQLite 只保存 secretRef。会话数据库依赖 Windows 用户权限与磁盘加密。</p></div></div>
      <SettingRow label="数据目录" description="设置、数据库与附件。"><code>%LOCALAPPDATA%\AiPin</code></SettingRow>
      <SettingRow label="数据库" description="SQLite · WAL · 迁移前自动备份。"><span className="state-text"><Database size={14} /> schema 1</span></SettingRow>
      <div className="data-transfer-section">
        <div className="data-transfer-heading"><FileDown size={18} /><div><strong>导出 AiPin 数据</strong><p>生成一个 .aipin 文件，便于复制到另一台电脑。配置文件包含主题、布局、模型定义和提示词；会话数据包含当前线程、历史、队列与附件。</p></div></div>
        <div className="data-transfer-actions" role="group" aria-label="导出范围">
          {(["configuration", "data", "all"] as PortableDataScope[]).map((scope) => <button key={scope} type="button" className={scope === "all" ? "primary-button" : "secondary-button"} disabled={Boolean(busy)} onClick={() => void exportPortable(scope)}>{busy === `export-${scope}` ? "正在导出…" : `导出${scopeLabel[scope]}`}</button>)}
        </div>
      </div>
      <div className="data-transfer-section">
        <div className="data-transfer-heading"><FileUp size={18} /><div><strong>导入 AiPin 数据</strong><p>可从同一种 .aipin 文件中只导入配置、只导入会话数据，或完整导入。写入前会校验文件版本、附件哈希并创建恢复备份。</p></div></div>
        <input ref={importRef} hidden type="file" accept=".aipin,application/json" onChange={(event) => void importPortable(event.currentTarget.files?.[0])} />
        <div className="data-transfer-actions" role="group" aria-label="导入范围">
          {(["configuration", "data", "all"] as PortableDataScope[]).map((scope) => <button key={scope} type="button" className={scope === "all" ? "primary-button" : "secondary-button"} disabled={Boolean(busy)} onClick={() => chooseImport(scope)}>{busy === `import-${scope}` ? "正在导入…" : `导入${scopeLabel[scope]}`}</button>)}
        </div>
        <p className="portable-key-note"><LockKeyhole size={13} /> 为避免泄露，API Key 永远不会写入迁移文件；换机后请在模型设置中重新填写。</p>
      </div>
      <SettingRow label="脱敏诊断" description="不包含 Key、提示词、回答全文、图片或原始文件路径。"><button type="button" className="secondary-button" onClick={exportDiagnostics}>导出诊断</button></SettingRow>
      <SettingRow label="清空全部数据" description="会删除本机历史、设置、附件和保存的凭据。"><button type="button" className="danger-button" onClick={clearData}><Trash2 size={14} /> 清空全部数据</button></SettingRow>
      {notice ? <div className="constraint-note" role="status"><Database size={17} /><div><strong>数据操作</strong><p>{notice}</p></div></div> : null}
    </div>
  );
}

function HistoryView() {
  const archives = useAppStore((state) => state.sessionHistory);
  const restoreSession = useAppStore((state) => state.restoreSession);
  const deleteSession = useAppStore((state) => state.deleteSession);
  const [modelFilter, setModelFilter] = useState("all");
  const [query, setQuery] = useState("");
  const models = useMemo(() => Array.from(new Map(archives.flatMap((archive) => archive.profiles).map((profile) => [profile.id, profile])).values()), [archives]);
  const rows = useMemo(() => archives.filter((archive) => {
    const matchesModel = modelFilter === "all" || archive.profiles.some((profile) => profile.id === modelFilter);
    const searchText = `${archive.title} ${archive.profiles.map((profile) => `${profile.providerName} ${profile.displayName}`).join(" ")}`.toLowerCase();
    return matchesModel && searchText.includes(query.trim().toLowerCase());
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [archives, modelFilter, query]);
  const groups = useMemo(() => rows.reduce<Record<string, typeof rows>>((result, row) => {
    const key = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(row.createdAt));
    (result[key] ??= []).push(row); return result;
  }, {}), [rows]);
  const restore = async (id: string) => {
    restoreSession(id);
    if (isTauri()) {
      await closeStandaloneSettings(true);
    }
  };
  return (
    <div className="settings-page history-page">
      <div className="section-heading"><div><h2>历史</h2><p>本地保存的多模型比较会话。</p></div></div>
      <div className="history-filters"><input className="history-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、供应商或模型" aria-label="搜索历史" /><select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)} aria-label="按模型筛选"><option value="all">全部模型</option>{models.map((profile) => <option key={profile.id} value={profile.id}>{profile.providerName} · {profile.displayName}</option>)}</select></div>
      {rows.length === 0 ? <div className="settings-empty"><FileClock size={24} /><h3>还没有匹配的历史</h3><p>执行单窗或全局新建会话后，当前内容会自动归档在这里。</p></div> : Object.entries(groups).map(([date, items]) => <section className="history-group" key={date}><h3>{date}</h3>{items.map((archive) => {
        const messageCount = Object.values(archive.threads).reduce((sum, thread) => sum + thread.messages.length, 0);
        return <div className="history-row" key={archive.id}><button type="button" className="history-row-main" onClick={() => void restore(archive.id)}><span className="provider-dot" style={{ background: archive.profiles[0]?.color }} /><div><strong>{archive.title}</strong><span>{archive.profiles.map((profile) => profile.displayName).join("、")} · {messageCount} 条消息</span></div><time>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(archive.createdAt))}</time><ChevronRight size={15} /></button><IconButton label="永久删除这条历史" danger onClick={() => { if (window.confirm("永久删除这条历史记录？")) deleteSession(archive.id); }}><Trash2 size={14} /></IconButton></div>;
      })}</section>)}
    </div>
  );
}

function GenericSettings({ section }: { section: ManagementSection }) {
  if (section === "appearance") return <AppearanceSettings />;
  if (section === "layout") return <LayoutSettings />;
  if (section === "conversation") return <ConversationSettings />;
  if (section === "prompts") return <PromptSettings />;
  if (section === "privacy") return <PrivacySettings />;
  if (section === "history") return <HistoryView />;
  if (section === "shortcuts") return <div className="settings-page"><div className="section-heading"><div><h2>快捷键</h2><p>全局与工作区快捷键。</p></div></div><SettingRow label="恢复窗口" description="即使窗口完全透明也可恢复。"><kbd>Ctrl + Alt + Space</kbd></SettingRow><SettingRow label="打开历史"><kbd>Ctrl + H</kbd></SettingRow><SettingRow label="停止当前批次"><kbd>Ctrl + C</kbd><span className="control-separator">或</span><kbd>Ctrl + .</kbd></SettingRow></div>;
  return <div className="settings-page"><div className="section-heading"><div><h2>关于 AiPin</h2><p>本地优先的 Windows 多模型对比客户端。</p></div></div><SettingRow label="应用版本"><code>1.0.0</code></SettingRow><SettingRow label="WebView2"><span className="state-text">Evergreen · 启动时检测</span></SettingRow><SettingRow label="数据库 schema"><code>1</code></SettingRow><SettingRow label="开源许可"><span className="state-text">MIT</span></SettingRow></div>;
}

export function ManagementView({ standalone = false }: { standalone?: boolean }) {
  const section = useAppStore((state) => state.managementSection);
  const setManagement = useAppStore((state) => state.setManagement);
  const sectionMeta = sections.find((item) => item.id === section);
  const close = async () => {
    if (standalone && isTauri()) {
      await closeStandaloneSettings();
    } else setManagement(false);
  };
  const minimize = async () => {
    if (!standalone || !isTauri()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().minimize();
  };
  const startWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!standalone) return;
    beginWindowDrag(event);
  };
  return (
    <main className="management-view" id="main-content">
      <h1 className="sr-only">AiPin {section === "history" ? "历史" : "设置"}</h1>
      <header className="management-topbar" onPointerDown={startWindowDrag}>
        {standalone ? <span className="management-drag-surface" aria-hidden="true" /> : null}
        <button type="button" className="back-button" onClick={close}><ArrowLeft size={16} /> {standalone ? "关闭设置" : "返回工作区"}</button>
        <strong>{section === "history" ? "历史" : "设置"}</strong>
        <div className="management-window-actions">
          {standalone ? <IconButton label="最小化设置窗口" onClick={() => void minimize()}><Minus size={15} /></IconButton> : null}
          <IconButton label="关闭设置窗口" onClick={close}><X size={16} /></IconButton>
        </div>
      </header>
      <div className="management-body">
        <nav className="settings-nav" aria-label="设置分类">
          {sections.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={section === id ? "active" : ""} onClick={() => setManagement(true, id)}><Icon size={16} /><span>{label}</span></button>)}
        </nav>
        <div className="narrow-section-select"><span>{sectionMeta?.label ?? "历史"}</span><select value={section} onChange={(event) => setManagement(true, event.target.value as ManagementSection)}>{sections.map(({ id, label }) => <option value={id} key={id}>{label}</option>)}</select></div>
        <div className="settings-content">{section === "models" ? <ModelManager /> : <GenericSettings section={section} />}</div>
      </div>
    </main>
  );
}
