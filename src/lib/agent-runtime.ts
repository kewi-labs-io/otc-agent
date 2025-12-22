// Serverless-compatible agent runtime with Drizzle ORM for Next.js
// DO NOT replace with an agent-simple.ts, it won't work!
import {
  AgentRuntime,
  ChannelType,
  EventType,
  elizaLogger,
  type Memory,
  type Plugin,
  stringToUuid,
  type UUID,
} from "@elizaos/core";
import { getDatabaseUrl, getGroqApiKey, getGroqModels, isProduction } from "@/config/env";
import agent from "./agent";

// Global state for serverless environment persistence
interface GlobalElizaState {
  __elizaMigrationsRan?: boolean;
  __elizaManagerLogged?: boolean;
  __elizaRuntime?: AgentRuntime | null;
  logger?: {
    log: typeof console.log;
    info: typeof console.info;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
  };
}

// Type assertion needed: globalThis doesn't have our custom properties by default
// This is a standard TypeScript pattern for extending global scope
const globalState = globalThis as GlobalElizaState;
if (typeof globalState.__elizaMigrationsRan === "undefined")
  globalState.__elizaMigrationsRan = false;
if (typeof globalState.__elizaManagerLogged === "undefined")
  globalState.__elizaManagerLogged = false;

class AgentRuntimeManager {
  private static instance: AgentRuntimeManager;
  public runtime: AgentRuntime | null = null;
  private hasRunMigrations = false;
  private initializationPromise: Promise<AgentRuntime> | null = null;

  private constructor() {
    // Configure the elizaLogger to use console
    if (elizaLogger) {
      elizaLogger.log = console.log.bind(console);
      elizaLogger.info = console.info.bind(console);
      elizaLogger.warn = console.warn.bind(console);
      elizaLogger.error = console.error.bind(console);
      elizaLogger.debug = console.debug.bind(console);
      elizaLogger.success = (msg: string | Record<string, unknown> | Error) =>
        console.log(`✓ ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
      // elizaLogger doesn't have notice in types but may be used at runtime
      const logger = elizaLogger as typeof elizaLogger & {
        notice?: typeof console.info;
      };
      logger.notice = console.info.bind(console);
    }

    // Also configure global console if needed
    if (!globalState.logger) {
      globalState.logger = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console),
      };
    }

    if (!globalState.__elizaManagerLogged) {
      // Silence noisy init log; keep flag to avoid repeated work
      globalState.__elizaManagerLogged = true;
    }
  }

  public static getInstance(): AgentRuntimeManager {
    if (!AgentRuntimeManager.instance) {
      AgentRuntimeManager.instance = new AgentRuntimeManager();
    }
    return AgentRuntimeManager.instance;
  }

  public isReady(): boolean {
    return true;
  }

  // Helper method to get or create the runtime instance
  // Uses a single initialization promise to prevent concurrent initialization attempts
  async getRuntime(): Promise<AgentRuntime> {
    // Priority 1: Reuse instance runtime if already set
    if (this.runtime) {
      return this.runtime;
    }

    // Priority 2: Reuse global cached runtime (persists across warm serverless containers)
    if (globalState.__elizaRuntime) {
      this.runtime = globalState.__elizaRuntime;
      return this.runtime;
    }

    // Priority 3: If initialization is already in progress, wait for it
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // Priority 4: Create new runtime with single initialization promise
    this.initializationPromise = this.createRuntime();

    // FAIL-FAST: If initialization fails, clear promise and throw
    try {
      const runtime = await this.initializationPromise;
      return runtime;
    } catch (error) {
      // Clear the promise so next attempt can try again
      this.initializationPromise = null;
      throw error;
    }
  }

  // Separate method for actual runtime creation (called once)
  private async createRuntime(): Promise<AgentRuntime> {
    console.log("[AgentRuntime] Creating runtime instance");

    // Get database URL from centralized config
    const postgresUrl = getDatabaseUrl();
    const isLocalDb = postgresUrl.includes("localhost") || postgresUrl.includes("127.0.0.1");

    // Validate database URL in production
    if (isProduction() && isLocalDb) {
      console.error("[AgentRuntime] ERROR: No database URL found in production");
      throw new Error(
        "Database connection failed: No database URL configured in production. " +
          "Vercel Neon Storage should provide DATABASE_POSTGRES_URL automatically. " +
          "Please check your Vercel project settings.",
      );
    }

    // Validate URL format (basic check) for remote databases
    if (!isLocalDb) {
      const isValidFormat =
        postgresUrl.startsWith("postgres://") || postgresUrl.startsWith("postgresql://");
      if (!isValidFormat) {
        console.warn(
          "[AgentRuntime] WARNING: Database URL doesn't start with postgres:// or postgresql://",
        );
      }
      // FAIL-FAST: Validate URL format - new URL() throws if invalid
      const url = new URL(postgresUrl.replace(/^postgres(ql)?:\/\//, "http://"));
      // FAIL-FAST: hostname is required in URL - if missing, URL is invalid
      if (!url.hostname || url.hostname === "") {
        throw new Error(
          "Database connection failed: Invalid database URL format (missing hostname)",
        );
      }
    }

    console.log(
      `[AgentRuntime] Database config: ${isLocalDb ? "localhost" : "remote (Vercel/Neon)"}`,
    );

    // Get model configuration from centralized config
    const models = getGroqModels();

    // Use the existing agent ID from DB (b850bc30-45f8-0041-a00a-83df46d8555d)
    const RUNTIME_AGENT_ID = "b850bc30-45f8-0041-a00a-83df46d8555d" as UUID;
    // FAIL-FAST: Plugins must be defined and non-null
    // Type assertion needed due to duplicate Plugin types from different node_modules locations
    if (!agent.plugins || !Array.isArray(agent.plugins)) {
      throw new Error("agent.plugins must be a non-empty array");
    }
    const plugins = agent.plugins.filter((p) => p != null) as Plugin[];
    if (plugins.length === 0) {
      throw new Error("agent.plugins array contains only null/undefined values");
    }

    // FAIL-FAST: Providers and actions are defined in agent.ts as filtered arrays
    // They should always be arrays, but validate for safety
    if (!Array.isArray(agent.providers)) {
      throw new Error("agent.providers must be an array");
    }
    if (!Array.isArray(agent.actions)) {
      throw new Error("agent.actions must be an array");
    }

    // FAIL-FAST: GROQ API key is required
    const groqApiKey = getGroqApiKey();
    if (!groqApiKey) {
      throw new Error("GROQ_API_KEY is required but not configured");
    }

    // Build runtime config - spread operator conflicts with strict typing
    // so we construct a minimal config object
    const runtimeConfig = {
      agentId: RUNTIME_AGENT_ID,
      character: agent.character,
      plugins,
      providers: agent.providers,
      actions: agent.actions,
      settings: {
        GROQ_API_KEY: groqApiKey,
        SMALL_GROQ_MODEL: models.small,
        LARGE_GROQ_MODEL: models.large,
        POSTGRES_URL: postgresUrl,
        ...agent.character.settings,
      },
    };

    // Type assertion: @elizaos/core runtime config is loosely typed
    this.runtime = new AgentRuntime(runtimeConfig as ConstructorParameters<typeof AgentRuntime>[0]);

    // Cache globally for reuse in warm container
    globalState.__elizaRuntime = this.runtime;

    // Ensure runtime has a logger with all required methods
    // elizaLogger provides the core logging methods required by AgentRuntime
    if (!this.runtime.logger) {
      // Type assertion: AgentRuntime.logger type comes from @elizaos/core
      // elizaLogger implements all required methods (log, info, warn, error, debug)
      // but may have additional methods not in the Logger interface
      type RuntimeLogger = typeof this.runtime.logger;
      this.runtime.logger = elizaLogger as RuntimeLogger;
    }

    // Ensure SQL plugin built-in tables exist (idempotent)
    await this.ensureBuiltInTables();

    // Initialize runtime - this calls ensureAgentExists internally (runtime.ts:405)
    // which creates both the agent record AND its entity record
    await this.runtime.initialize();

    // Log registered services
    const services = Array.from(this.runtime.getAllServices().keys());
    console.log("[AgentRuntime] Registered services:", services);

    return this.runtime;
  }

  private async ensureBuiltInTables(): Promise<void> {
    if (this.hasRunMigrations || globalState.__elizaMigrationsRan) return;

    this.hasRunMigrations = true;
    globalState.__elizaMigrationsRan = true;

    // Database adapter and migrations are handled by @elizaos/plugin-sql during runtime.initialize()
    // Quotes and user sessions are stored via runtime.getCache/setCache
    console.log("[AgentRuntime] Using Eliza cache system for quote storage");
  }

  // Helper method to handle messages
  // Note: attachments type matches ElizaOS Memory.content.attachments (Media[])
  public async handleMessage(
    roomId: string,
    entityId: string,
    content: { text?: string; attachments?: Memory["content"]["attachments"] },
  ): Promise<Memory> {
    const runtime = await this.getRuntime();

    // Ensure room and entity connection (follows Eliza's ensureConnection pattern)
    const entityUuid = stringToUuid(entityId) as UUID;
    await runtime.ensureConnection({
      entityId: entityUuid,
      roomId: stringToUuid(roomId),
      worldId: stringToUuid("otc-desk-world"),
      source: "web",
      type: ChannelType.DM,
      channelId: roomId,
      userName: entityId,
    });

    const messageText = content.text || "";
    const messageAttachments = content.attachments || [];

    // Create user message
    const userMessage: Memory = {
      roomId: roomId as UUID,
      entityId: entityUuid,
      agentId: runtime.agentId as UUID,
      content: {
        text: messageText,
        attachments: messageAttachments,
      },
    };
    // Emit MESSAGE_RECEIVED and delegate handling to plugins
    // Note: The message handler plugin (otcDeskPlugin) is responsible for:
    // 1. Saving the user message to memory
    // 2. Generating the agent response
    // 3. Saving the agent response to memory
    // The callback is just for notification - do NOT create memory here
    // to avoid duplicate agent messages.
    await runtime.emitEvent(EventType.MESSAGE_RECEIVED, {
      runtime,
      message: {
        id: userMessage.id,
        content: {
          text: messageText,
          attachments: messageAttachments,
        },
        entityId: stringToUuid(entityId) as UUID,
        agentId: runtime.agentId,
        roomId: roomId,
        createdAt: Date.now(),
      },
      callback: async () => {
        // Callback is for notification only - memory is saved by the message handler
        console.log("[AgentRuntime] Message handler completed");
      },
    });

    return userMessage;
  }
}

// Export singleton instance
export const agentRuntime = AgentRuntimeManager.getInstance();
