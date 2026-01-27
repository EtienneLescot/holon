import * as vscode from "vscode";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";

type JsonObject = Record<string, unknown>;

interface RpcRequest {
  id: number;
  method: string;
  params?: JsonObject;
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { message: string };
}

export type CorePosition = { x: number; y: number };
export type CoreNode = {
  id: string;
  name: string;
  kind: "node" | "workflow" | "spec";
  position?: CorePosition | null;
  label?: string | null;
  node_type?: string | null;
  props?: Record<string, unknown> | null;
};

export type CoreEdge = {
  source: string;
  target: string;
  source_port?: string | null;
  target_port?: string | null;
  kind?: "code" | "link" | null;
};
export type CoreGraph = { nodes: CoreNode[]; edges: CoreEdge[] };

export class RpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, (response: RpcResponse) => void>();
  private readonly output: vscode.OutputChannel;

  private constructor(child: ChildProcessWithoutNullStreams, output: vscode.OutputChannel) {
    this.child = child;
    this.output = output;

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }

      if (!isRpcResponse(parsed)) {
        return;
      }

      const resolve = this.pending.get(parsed.id);
      if (!resolve) {
        return;
      }
      this.pending.delete(parsed.id);
      resolve(parsed);
    });

    child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.output.appendLine(`Python exited (code=${code}, signal=${signal ?? "none"})`);
      // Fail any pending requests.
      for (const [id, resolve] of this.pending) {
        resolve({ id, error: { message: "Python process exited" } });
      }
      this.pending.clear();
      rl.close();
    });
  }

  public static async start(extensionUri: vscode.Uri, outputChannel?: vscode.OutputChannel): Promise<RpcClient> {
    const config = vscode.workspace.getConfiguration("holon");
    const pythonPath = config.get<string>("pythonPath") ?? "python3";

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      throw new Error("No workspace folder is open");
    }

    const output = outputChannel ?? vscode.window.createOutputChannel("Holon");
    output.appendLine("Starting Holon Python RPC...");

    const coreDir = resolveCoreDir({ workspaceFolder, extensionUri });
    output.appendLine(`coreDir: ${coreDir}`);

    // 1) Try configured pythonPath with PYTHONPATH=core/.
    try {
      const client = await RpcClient.spawnAndHandshake({
        output,
        command: pythonPath,
        args: ["-m", "holon.rpc.server"],
        cwd: workspaceFolder.uri.fsPath,
        env: {
          ...process.env,
          PYTHONPATH: coreDir,
        },
      });
      output.appendLine(`Started with ${pythonPath}`);
      return client;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`Failed to start with ${pythonPath}: ${message}`);
    }

    // 1b) Fallback to a local venv in core/ if present.
    const venvPython = detectLocalVenvPython(coreDir);
    if (venvPython) {
      try {
        const client = await RpcClient.spawnAndHandshake({
          output,
          command: venvPython,
          args: ["-m", "holon.rpc.server"],
          cwd: workspaceFolder.uri.fsPath,
          env: {
            ...process.env,
            PYTHONPATH: coreDir,
          },
        });
        output.appendLine(`Started with local venv: ${venvPython}`);
        return client;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        output.appendLine(`Failed to start with local venv: ${message}`);
      }
    }

    // 2) Fallback to Poetry if available. This uses the core/ Poetry environment.
    const poetryCwd = coreDir;
    const poetryArgs = ["run", "python", "-m", "holon.rpc.server"];

    try {
      const client = await RpcClient.spawnAndHandshake({
        output,
        command: "poetry",
        args: poetryArgs,
        cwd: poetryCwd,
        env: {
          ...process.env,
          // Ensure imports work even if project isn't installed in the env yet.
          PYTHONPATH: coreDir,
        },
      });

      output.appendLine("Started with poetry run python");
      return client;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      output.appendLine(`Failed to start with poetry: ${message}`);
      throw new Error(
        "Unable to start Holon Python RPC. Set holon.pythonPath to a Python that has holon-core deps installed (e.g. Poetry venv), or ensure `poetry` is on PATH."
      );
    }
  }

  private static async spawnAndHandshake(input: {
    output: vscode.OutputChannel;
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
  }): Promise<RpcClient> {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: "pipe",
    });

    input.output.appendLine(`spawn: ${input.command} ${input.args.join(" ")}`);

    child.stderr.on("data", (chunk: Buffer) => {
      input.output.appendLine(chunk.toString("utf8").trimEnd());
    });

    child.on("error", (e: Error) => {
      input.output.appendLine(`spawn error: ${e.message}`);
    });

    const client = new RpcClient(child, input.output);

    // Handshake: if ping fails quickly, the process likely crashed (missing deps, etc.).
    await withTimeout(client.ping(), 1500, "Python RPC handshake timed out");
    return client;
  }

  public async ping(): Promise<void> {
    const response = await this.request({ method: "ping" });
    if (response.error) {
      throw new Error(response.error.message);
    }
    if (response.result !== "pong") {
      throw new Error("Invalid ping response");
    }
  }

  public async hello(): Promise<string> {
    const response = await this.request({ method: "hello" });
    if (response.error) {
      throw new Error(response.error.message);
    }
    if (typeof response.result !== "string") {
      throw new Error("Invalid hello response type");
    }
    return response.result;
  }

  public async parseSource(source: string): Promise<CoreGraph> {
    const response = await this.request({ method: "parse_source", params: { source } });
    if (response.error) {
      throw new Error(response.error.message);
    }
    if (!isCoreGraph(response.result)) {
      throw new Error("Invalid parse_source response type");
    }
    return response.result;
  }

  public async renameNode(source: string, oldName: string, newName: string): Promise<string> {
    const response = await this.request({
      method: "rename_node",
      params: { source, old_name: oldName, new_name: newName },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as unknown;
    if (!isObject(result) || typeof result["source"] !== "string") {
      throw new Error("Invalid rename_node response type");
    }
    return result["source"];
  }

  public async patchNode(source: string, nodeName: string, newFunctionCode: string): Promise<string> {
    const response = await this.request({
      method: "patch_node",
      params: { source, node_name: nodeName, new_function_code: newFunctionCode },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as unknown;
    if (!isObject(result) || typeof result["source"] !== "string") {
      throw new Error("Invalid patch_node response type");
    }
    return result["source"];
  }

  public async addSpecNode(source: string, nodeId: string, nodeType: string, label: string | null, props: Record<string, unknown> | null): Promise<string> {
    const response = await this.request({
      method: "add_spec_node",
      params: { source, node_id: nodeId, node_type: nodeType, label, props },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as unknown;
    if (!isObject(result) || typeof result["source"] !== "string") {
      throw new Error("Invalid add_spec_node response type");
    }
    return result["source"];
  }

  public async patchSpecNode(input: {
    source: string;
    nodeId: string;
    nodeType?: string | null;
    label?: string | null;
    props?: Record<string, unknown> | null;
    setNodeType: boolean;
    setLabel: boolean;
    setProps: boolean;
  }): Promise<string> {
    const response = await this.request({
      method: "patch_spec_node",
      params: {
        source: input.source,
        node_id: input.nodeId,
        node_type: input.nodeType ?? null,
        label: input.label ?? null,
        props: input.props ?? null,
        set_node_type: input.setNodeType,
        set_label: input.setLabel,
        set_props: input.setProps,
      },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as unknown;
    if (!isObject(result) || typeof result["source"] !== "string") {
      throw new Error("Invalid patch_spec_node response type");
    }
    return result["source"];
  }

  public async addLink(
    source: string,
    workflowName: string,
    sourceNodeId: string,
    sourcePort: string,
    targetNodeId: string,
    targetPort: string
  ): Promise<string> {
    const response = await this.request({
      method: "add_link",
      params: {
        source,
        workflow_name: workflowName,
        source_node_id: sourceNodeId,
        source_port: sourcePort,
        target_node_id: targetNodeId,
        target_port: targetPort,
      },
    });
    if (response.error) {
      throw new Error(response.error.message);
    }
    const result = response.result as unknown;
    if (!isObject(result) || typeof result["source"] !== "string") {
      throw new Error("Invalid add_link response type");
    }
    return result["source"];
  }

  public async stop(): Promise<void> {
    try {
      await this.request({ method: "shutdown" });
    } catch {
      // ignore
    } finally {
      this.child.kill();
    }
  }

  private request(input: Omit<RpcRequest, "id">): Promise<RpcResponse> {
    const id = this.nextId;
    this.nextId += 1;

    const req: RpcRequest = { id, ...input };

    const payload = JSON.stringify(req);
    this.child.stdin.write(payload + "\n");

    return new Promise<RpcResponse>((resolve) => {
      this.pending.set(id, resolve);
    });
  }
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return typeof obj["id"] === "number";
}

function isCoreGraph(value: unknown): value is CoreGraph {
  if (!isObject(value)) {
    return false;
  }
  const nodes = value["nodes"];
  const edges = value["edges"];
  return Array.isArray(nodes) && nodes.every(isCoreNode) && Array.isArray(edges) && edges.every(isCoreEdge);
}

function isCoreNode(value: unknown): value is CoreNode {
  if (!isObject(value)) {
    return false;
  }
  const kind = value["kind"];
  const position = value["position"];
  const positionOk =
    position === undefined ||
    position === null ||
    (isObject(position) && typeof position["x"] === "number" && typeof position["y"] === "number");
  return (
    typeof value["id"] === "string" &&
    typeof value["name"] === "string" &&
    (kind === "node" || kind === "workflow" || kind === "spec") &&
    positionOk
  );
}

function isCoreEdge(value: unknown): value is CoreEdge {
  if (!isObject(value)) {
    return false;
  }
  return typeof value["source"] === "string" && typeof value["target"] === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: unknown) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function resolveCoreDir(input: {
  workspaceFolder: vscode.WorkspaceFolder;
  extensionUri: vscode.Uri;
}): string {
  const workspaceCore = path.join(input.workspaceFolder.uri.fsPath, "core");
  if (fs.existsSync(path.join(workspaceCore, "holon"))) {
    return workspaceCore;
  }

  // Dev scenario: extension is at <repo>/extension and core is a sibling.
  const maybeRepoRoot = path.dirname(input.extensionUri.fsPath);
  const siblingCore = path.join(maybeRepoRoot, "core");
  if (fs.existsSync(path.join(siblingCore, "holon"))) {
    return siblingCore;
  }

  throw new Error(
    "Cannot locate core/ (expected <workspace>/core or sibling of extension/). Open the monorepo root as workspace."
  );
}

function detectLocalVenvPython(coreDir: string): string | undefined {
  const candidate = path.join(coreDir, ".venv", "bin", "python");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return undefined;
}
