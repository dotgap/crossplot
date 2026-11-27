/// <reference lib="webworker" />
// Entry point for the engine worker. Import as a module worker.
import { serveEngine } from "./engine/protocol.js";

serveEngine(self as unknown as DedicatedWorkerGlobalScope);
